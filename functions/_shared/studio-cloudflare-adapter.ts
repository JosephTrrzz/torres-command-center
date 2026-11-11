import manifest from '../../lib/canvas-manifest.json';
import routes from '../../public/website-preview/pages.json';
import { studioStore } from './studio-access';
import { advanceBuildAttempt, getBuildAttempt, reserveBuildAttempt, type BuildAttempt, type BuildEnvironment, type PreviewEvidence } from './studio-build-attempts';
import { dispatchStudioBuild, observeStudioBuild } from './studio-build-dispatch';
import { readStudioGitBuild, STUDIO_BUILD_BRANCHES, type DeploymentEvidence } from './studio-cloudflare-build';
import { STUDIO_CLOUDFLARE_TARGET as target, verifyStudioCloudflareCredential } from './studio-cloudflare';
import { compileTorresArtifact } from './studio-torres-artifact';
import { canonical, contentHash, UUID, type Publication, type PublisherBinding, type PublishingEnv } from './studio-publisher';

/** Loaded from reviewed, server-owned enrollment evidence, never request data.
 * The callback must validate the actual bootstrap/rollback results it represents.
 * rollbackVerified must describe a separately implemented and tested recovery
 * workflow. Capturing a previous deployment ID is NOT rollback verification.
 * This module has no rollback execution method and does not install a runner,
 * configure secrets or enable enrollment. */
export type StudioEnrollmentEvidence = {
  clientId: string; snapshotId: string; publicUrl: string; sourceCommit: string; verifiedAt: string;
  previewDeploymentId: string; rollbackDeploymentId: string;
  rendererVerified: true; buildInputVerified: true; durableDispatchVerified: true; rollbackVerified: true;
};
export type StudioDeploymentVerification = {
  release: Readonly<Publication>; attempt: Readonly<BuildAttempt>;
  deployment: Readonly<DeploymentEvidence>;
  artifact: Awaited<ReturnType<typeof compileTorresArtifact>>;
};
export type StudioCloudflareAdapterOptions = {
  sourceCommit: string;
  loadEnrollmentEvidence?: () => Promise<StudioEnrollmentEvidence | null>;
  /** Return null while verification is unavailable/incomplete. Only real browser
   * checks of the specified immutable deployment may return success evidence.
   * Used for BOTH preview and production; provider success is not browser proof. */
  verifyDeployment?: (input: StudioDeploymentVerification) => Promise<PreviewEvidence | null>;
};
const digest = /^[a-f0-9]{64}$/;
const active = ['queued','deploying','verifying'];
class AdapterError extends Error {
  constructor(readonly status: number) { super('Publishing adapter request could not be completed.'); }
}
const reply = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Verify the pinned runner's real browser-test attestation against deployed bytes.
 * This does not run a browser itself. Security depends on the approved runner
 * emitting verification.json ONLY after its actual Playwright tests pass.
 * Install explicitly as verifyDeployment; it does not authorize enrollment.
 */
export async function verifyStudioCloudflareDeployment(input: StudioDeploymentVerification): Promise<PreviewEvidence | null> {
  const { release:p, attempt:a, deployment:d, artifact } = input;
  const expectedHash = /^\/_studio\/([a-f0-9]{64})\.js$/.exec(artifact.assetPath)?.[1];
  const origin = `https://${d.id.slice(0,8)}.${target.project}.pages.dev`;
  if (!UUID.test(d.id) || d.state !== 'succeeded' || d.url !== origin || a.provider_deployment_id !== d.id
    || !['building','ambiguous'].includes(a.stage) || !UUID.test(a.id) || a.client_id !== target.client || p.client_id !== target.client
    || p.id !== a.release_id || p.snapshot_id !== manifest.id || p.content_hash !== a.content_hash
    || a.source_commit !== d.sourceCommit || a.branch !== STUDIO_BUILD_BRANCHES[a.environment] || a.branch !== d.branch || a.environment !== d.environment
    || artifact.releaseId !== p.id || artifact.contentHash !== p.content_hash || artifact.sourceCommit !== a.source_commit
    || !expectedHash || artifact.routes.length !== routes.length || artifact.routes.some((r,i) => r !== routes[i].route)
    || artifact.marker !== `<meta name="torres-studio-release" content="${p.id}:${p.content_hash}">`
    || await contentHash({script:artifact.script,sourceCommit:a.source_commit,contentHash:p.content_hash}) !== expectedHash) return null;
  async function bounded(path: string, limit: number, mime: string, head = false) {
    // Paths are fixed locally or compiler-validated, never proof-supplied URLs.
    const response = await fetch(origin + path, {redirect:'manual',signal:AbortSignal.timeout(5000)});
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes(mime)) throw Error('Invalid deployed resource.');
    const reader = response.body?.getReader(); if (!reader) throw Error('Missing deployed resource.');
    const decoder = new TextDecoder('utf-8',{fatal:true}); let text = '', bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { text += decoder.decode(); break; }
        const remaining = limit-bytes;
        if (head) {
          const part = chunk.value.subarray(0,remaining); bytes += part.length;
          text += decoder.decode(part,{stream:true});
          const end = text.indexOf('</head>');
          if (end >= 0) return text.slice(0,end+7);
          if (bytes >= limit) throw Error('Head exceeds limit.');
        } else {
          bytes += chunk.value.length;
          if (bytes > limit) throw Error('Resource exceeds limit.');
          text += decoder.decode(chunk.value,{stream:true});
        }
      }
      if (head && !text.includes('</head>')) throw Error('Missing document head.');
      return text;
    } finally { await reader.cancel(); }
  }
  try {
    const proof = JSON.parse(await bounded('/_studio/verification.json',8192,'application/json'));
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)
      || Object.keys(proof).sort().join(',') !== 'artifactHash,attemptId,contentHash,deploymentId,functionalVerified,protocol,releaseId,routesVerified,runtimeVerified,sourceCommit'
      || proof.protocol !== 1 || proof.attemptId !== a.id || proof.deploymentId !== d.id || proof.releaseId !== p.id
      || proof.contentHash !== p.content_hash || proof.sourceCommit !== a.source_commit || proof.artifactHash !== expectedHash
      || proof.routesVerified !== true || proof.runtimeVerified !== true || proof.functionalVerified !== true) return null;
    const script = await bounded(artifact.assetPath,4_500_000,'javascript');
    if (script !== artifact.script) return null;
    const scriptTag = `<script src="${artifact.assetPath}" defer data-torres-studio="${p.id}"></script>`;
    for (let i=0;i<routes.length;i+=3) {
      const checks = await Promise.all(routes.slice(i,i+3).map(async page => {
        const head = await bounded(page.route,65536,'text/html',true);
        // Ignore comment contents: a quoted marker is not deployment evidence.
        const actual = head.replace(/<!--[\s\S]*?-->/g,'')
          .replace(/(<(script|style|title|noscript|textarea)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi,'$1$3');
        return actual.includes(artifact.marker) && actual.includes(scriptTag);
      }));
      if (checks.some(ok => !ok)) return null;
    }
    return {deployment_id:d.id,artifact_hash:expectedHash,verified_at:new Date().toISOString(),
      routes_verified:true,runtime_verified:true,functional_verified:true};
  } catch { return null; }
}

/** Stable across worker restarts, hash/source config changes and lost responses.
 * These SHA-256-derived UUID-shaped keys identify jobs, not provider deployments.
 * A changed immutable input must conflict with the old row, never create a retry. */
export async function studioBuildAttemptId(clientId: string, releaseId: string, environment: BuildEnvironment) {
  const h = await contentHash(['torres-studio-build-v1', clientId, releaseId, environment]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

/** Private in-process implementation of PublisherBinding. Do not expose this
 * fetch method as an unauthenticated public route. The caller remains responsible
 * for studioAccess; the adapter independently binds all work to the stored release.
 * Receipt deploymentId is the stable orchestration ID, NOT either Cloudflare ID.
 */
export function createStudioCloudflareAdapter(env: PublishingEnv, options: StudioCloudflareAdapterOptions): PublisherBinding {
  const sourceCommit = options.sourceCommit;
  const loadEnrollment = options.loadEnrollmentEvidence;
  const verifier = options.verifyDeployment;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('An approved source commit is required.');

  async function enrolled(): Promise<StudioEnrollmentEvidence | null> {
    if (!env.STUDIO_CLOUDFLARE_API_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY || !loadEnrollment || !verifier) return null;
    try {
      const e = await loadEnrollment();
      const valid = !!e && e.clientId === target.client && e.snapshotId === manifest.id && e.publicUrl === manifest.source
        && e.sourceCommit === sourceCommit && typeof e.verifiedAt === 'string' && Number.isFinite(Date.parse(e.verifiedAt))
        && Date.parse(e.verifiedAt) <= Date.now() && UUID.test(e.previewDeploymentId) && UUID.test(e.rollbackDeploymentId)
      && e.rendererVerified === true && e.buildInputVerified === true && e.durableDispatchVerified === true && e.rollbackVerified === true;
      return valid && e ? { ...e } : null;
    } catch { return null; }
  }
  async function read(path: string): Promise<unknown[]> {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new AdapterError(503);
    const { rest, headers } = studioStore(env);
    const response = await fetch(rest + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new AdapterError(503);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) throw new AdapterError(503);
    return rows;
  }
  async function publication(id: string): Promise<Publication> {
    const [raw] = await read(`/studio_publications?client_id=eq.${target.client}&id=eq.${id}&select=id,client_id,snapshot_id,revision,content_hash,status,deployment_id,created_at,verified_at&limit=1`);
    if (!raw) throw new AdapterError(404);
    const p = raw as Publication;
    if (p.id !== id || p.client_id !== target.client || p.snapshot_id !== manifest.id || !Number.isSafeInteger(p.revision) || p.revision < 1
      || !p.content_hash || !digest.test(p.content_hash) || ![...active,'live','failed'].includes(p.status)
      || p.deployment_id !== null && p.deployment_id !== receiptId(p)) throw new AdapterError(409);
    return { id:p.id,client_id:p.client_id,snapshot_id:p.snapshot_id,revision:p.revision,content_hash:p.content_hash,
      status:p.status,deployment_id:p.deployment_id,created_at:p.created_at,verified_at:p.verified_at };
  }
  const receiptId = (p: Publication) => 'studio-' + p.id;
  function receipt(p: Publication, status: 'queued'|'building'|'deploying'|'succeeded'|'failed', phase: string) {
    return reply({ protocol:1,releaseId:p.id,clientId:p.client_id,snapshotId:p.snapshot_id,revision:p.revision,
      contentHash:p.content_hash,deploymentId:receiptId(p),status,phase });
  }
  function exact(a: BuildAttempt, p: Publication, environment: BuildEnvironment, id: string) {
    if (a.id !== id || a.release_id !== p.id || a.client_id !== p.client_id || a.content_hash !== p.content_hash
      || a.source_commit !== sourceCommit || a.environment !== environment || a.branch !== STUDIO_BUILD_BRANCHES[environment]) throw new AdapterError(409);
    return a;
  }
  async function attempt(p: Publication, environment: BuildEnvironment) {
    const id = await studioBuildAttemptId(p.client_id,p.id,environment);
    const a = await getBuildAttempt(env,{id,clientId:p.client_id});
    return a ? exact(a,p,environment,id) : null;
  }
  async function artifact(p: Publication, suppliedDraft?: unknown) {
    let draft = suppliedDraft;
    if (draft === undefined) {
      const [saved] = await read(`/studio_canvas_drafts?client_id=eq.${p.client_id}&snapshot_id=eq.${p.snapshot_id}&revision=eq.${p.revision}&select=draft&limit=1`);
      if (!saved || typeof saved !== 'object') throw new AdapterError(503);
      draft = (saved as {draft:unknown}).draft;
    }
    return compileTorresArtifact({releaseId:p.id,snapshotId:p.snapshot_id,revision:p.revision,contentHash:p.content_hash!,sourceCommit,draft});
  }
  function validProof(proof: PreviewEvidence | null, deploymentId: string, artifactHash: string): proof is PreviewEvidence {
    return !!proof && Object.keys(proof).sort().join(',') === 'artifact_hash,deployment_id,functional_verified,routes_verified,runtime_verified,verified_at'
      && proof.deployment_id === deploymentId && proof.artifact_hash === artifactHash
      && proof.routes_verified === true && proof.runtime_verified === true && proof.functional_verified === true
      && typeof proof.verified_at === 'string' && Number.isFinite(Date.parse(proof.verified_at)) && Date.parse(proof.verified_at) <= Date.now();
  }
  const artifactHash = (a: Awaited<ReturnType<typeof compileTorresArtifact>>) => {
    const match = /^\/_studio\/([a-f0-9]{64})\.js$/.exec(a.assetPath);
    if (!match) throw new AdapterError(409);
    return match[1];
  };
  async function mayStart(p: Publication) {
    if (!active.includes(p.status) || !await enrolled()) return false;
    const [raw] = await read(`/studio_sites?client_id=eq.${p.client_id}&select=enabled,publishing_enabled,canvas_snapshot_id,public_url&limit=1`);
    const site = raw as {enabled?:boolean;publishing_enabled?:boolean;canvas_snapshot_id?:string;public_url?:string} | undefined;
    return site?.enabled === true && site.publishing_enabled === true && site.canvas_snapshot_id === p.snapshot_id
      && site.public_url?.replace(/\/$/,'') === manifest.source;
  }
  async function reserve(p: Publication, environment: BuildEnvironment, preview?: BuildAttempt, previous?: string) {
    const id = await studioBuildAttemptId(p.client_id,p.id,environment);
    return exact(await reserveBuildAttempt(env,{id,releaseId:p.id,clientId:p.client_id,contentHash:p.content_hash!,sourceCommit,
      environment,branch:STUDIO_BUILD_BRANCHES[environment],
      ...(environment === 'production' ? {previewAttemptId:preview!.id,previousProductionDeploymentId:previous!} : {})}),p,environment,id);
  }
  async function previousProduction(p: Publication, expectedId?: string): Promise<string | null> {
    const enrollment = await enrolled();
    if (!enrollment) return null;
    const previous = await verifyStudioCloudflareCredential(env.STUDIO_CLOUDFLARE_API_TOKEN);
    if (previous.credential !== 'verified' || !/^[a-f0-9]{40}$/.test(previous.sourceCommit) || !UUID.test(previous.deploymentId)
      || expectedId !== undefined && previous.deploymentId !== expectedId
      || previous.sourceCommit !== sourceCommit && previous.deploymentId !== enrollment.rollbackDeploymentId) return null;
    const checked = await readStudioGitBuild(env.STUDIO_CLOUDFLARE_API_TOKEN!,{
      id:await studioBuildAttemptId(p.client_id,p.id,'production'),source_commit:previous.sourceCommit,environment:'production',branch:STUDIO_BUILD_BRANCHES.production,
    },previous.deploymentId);
    return checked.outcome === 'verified' && checked.deployment.state === 'succeeded'
      && checked.deployment.id === previous.deploymentId && checked.deployment.sourceCommit === previous.sourceCommit
      && checked.deployment.environment === 'production' && checked.deployment.branch === STUDIO_BUILD_BRANCHES.production ? previous.deploymentId : null;
  }
  async function progress(p: Publication, a: BuildAttempt, observeOnly: boolean) {
    if (a.stage === 'reserved') {
      if (observeOnly || !await mayStart(p)) return a;
      // Validate the current compiler before dispatch, including a recovered reservation.
      const compiled = await artifact(p);
      if (a.environment === 'production' && (!a.preview_evidence || a.preview_evidence.artifact_hash !== artifactHash(compiled))) throw new AdapterError(409);
      // Reservation and dispatch happen in separate reconciliations. Never
      // replace a newer production deployment using a stale rollback baseline.
      if (a.environment === 'production' && (!a.previous_production_deployment_id
        || !await previousProduction(p,a.previous_production_deployment_id))) return a;
      const saved = await dispatchStudioBuild(env,{id:a.id,clientId:p.client_id});
      if (!saved) throw new AdapterError(503);
      return exact(saved,p,a.environment,a.id);
    }
    if (['succeeded','failed'].includes(a.stage)) return a;
    const observed = await observeStudioBuild(env,{id:a.id,clientId:p.client_id});
    if (!observed.attempt) throw new AdapterError(503);
    a = exact(observed.attempt,p,a.environment,a.id);
    if (a.stage === 'failed' || !observed.provider || observed.provider.state !== 'succeeded' || !verifier) return a;
    const d = observed.provider;
    if (d.id !== a.provider_deployment_id || d.sourceCommit !== a.source_commit || d.environment !== a.environment || d.branch !== a.branch) throw new AdapterError(409);
    const compiled = await artifact(p);
    // A null result keeps the build pending; no fabricated proof and no new build.
    const proof = await verifier({release:structuredClone(p),attempt:structuredClone(a),deployment:structuredClone(d),artifact:structuredClone(compiled)});
    if (!proof) return a;
    if (!validProof(proof,d.id,artifactHash(compiled)) || Date.parse(proof.verified_at) < Date.parse(d.createdAt)) throw new AdapterError(409);
    if (a.environment === 'production' && a.preview_evidence?.artifact_hash !== proof.artifact_hash) throw new AdapterError(409);
    const saved = await advanceBuildAttempt(env,{id:a.id,clientId:p.client_id,expectedStage:a.stage,stage:'succeeded',providerDeploymentId:d.id,
      ...(a.environment === 'preview' ? {previewEvidence:proof} : {})});
    return saved ? exact(saved,p,a.environment,a.id) : (await attempt(p,a.environment)) ?? a;
  }
  async function drive(p: Publication, create: boolean, observeOnly = false) {
    let preview = await attempt(p,'preview');
    let production = await attempt(p,'production');
    if (!preview) {
      if (production) throw new AdapterError(409);
      if (!create || observeOnly) throw new AdapterError(404);
      if (!await mayStart(p)) throw new AdapterError(503);
      preview = await reserve(p,'preview');
    }
    if (production) {
      if (preview.stage !== 'succeeded' || !preview.provider_deployment_id || production.preview_attempt_id !== preview.id
        || !validProof(preview.preview_evidence,preview.provider_deployment_id,production.preview_evidence?.artifact_hash ?? '')
        || canonical(production.preview_evidence) !== canonical(preview.preview_evidence) || !production.previous_production_deployment_id) throw new AdapterError(409);
      production = await progress(p,production,observeOnly);
      return receipt(p,production.stage === 'succeeded' ? 'succeeded' : production.stage === 'failed' ? 'failed' : 'deploying','production');
    }
    if (preview.stage === 'failed') return receipt(p,'failed','preview');
    if (preview.stage !== 'succeeded') {
      preview = await progress(p,preview,observeOnly);
      return receipt(p,preview.stage === 'failed' ? 'failed' : 'building',preview.stage === 'succeeded' ? 'preview_verified' : 'preview');
    }
    const compiled = await artifact(p);
    if (!preview.provider_deployment_id || !validProof(preview.preview_evidence,preview.provider_deployment_id,artifactHash(compiled))) throw new AdapterError(409);
    if (observeOnly || !await mayStart(p)) return receipt(p,'building','awaiting_enrollment');
    // Capture the actual prior production identity before reserving the new build.
    // Never substitute the preview ID or a user-supplied rollback target.
    // Installing the runner changes the approved source SHA. For first publish,
    // only the exact enrolled baseline ID may have a different source commit.
    // Later production deployments must use the currently approved source.
    const previous = await previousProduction(p);
    if (!previous) return receipt(p,'building','awaiting_production_identity');
    production = await reserve(p,'production',preview,previous);
    // Separate reservation and dispatch into distinct reconciliations. A lost
    // response can be recovered by deterministic ID without another create call.
    return receipt(p,'deploying',production.stage === 'reserved' ? 'production_reserved' : 'production');
  }
  return { async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== 'https://studio-publisher.internal' || request.headers.has('origin') || request.headers.has('cookie')) throw new AdapterError(403);
      if (request.method === 'GET' && url.pathname === '/capabilities') {
        if (url.searchParams.get('client') !== target.client || Array.from(url.searchParams.keys()).some(k => k !== 'client') || url.searchParams.getAll('client').length !== 1) throw new AdapterError(403);
        const ready = !!await enrolled();
        return reply({protocol:1,clientId:target.client,snapshotId:manifest.id,publicUrl:manifest.source,
          safeRenderer:ready,durableIdempotency:ready,rollback:ready});
      }
      if (request.method === 'GET') {
        const match = /^\/releases\/([a-f0-9-]{36})$/i.exec(url.pathname);
        if (!match || !UUID.test(match[1]) || url.searchParams.get('client') !== target.client
          || Array.from(url.searchParams.keys()).some(k => k !== 'client' && k !== 'observe') || url.searchParams.getAll('client').length !== 1
          || url.searchParams.getAll('observe').length > 1 || url.searchParams.has('observe') && url.searchParams.get('observe') !== '1') throw new AdapterError(400);
        return await drive(await publication(match[1]),false,url.searchParams.get('observe') === '1');
      }
      if (request.method !== 'POST' || url.pathname !== '/releases' || url.search) throw new AdapterError(405);
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AdapterError(415);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 4_100_000) throw new AdapterError(413);
      let body; try { body = JSON.parse(raw); } catch { throw new AdapterError(400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'clientId,contentHash,draft,protocol,publicUrl,releaseId,revision,snapshotId'
        || body.protocol !== 1 || body.clientId !== target.client || body.snapshotId !== manifest.id || body.publicUrl !== manifest.source
        || typeof body.releaseId !== 'string' || !UUID.test(body.releaseId) || typeof body.contentHash !== 'string' || !digest.test(body.contentHash)
        || !Number.isSafeInteger(body.revision) || body.revision < 1) throw new AdapterError(400);
      const p = await publication(body.releaseId);
      if (p.content_hash !== body.contentHash || p.revision !== body.revision) throw new AdapterError(409);
      await artifact(p,body.draft); // Independently validates schema, source and fingerprint.
      return await drive(p,true);
    } catch (error) {
      // Neither compiler errors nor provider/storage payloads may leak drafts/secrets.
      return reply({error:'Publishing confirmation is unavailable. Existing attempts remain reserved for reconciliation.'},error instanceof AdapterError ? error.status : 503);
    }
  } };
}
