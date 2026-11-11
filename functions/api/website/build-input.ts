import { authJson } from '../../_shared/auth';
import { studioStore } from '../../_shared/studio-access';
import { getBuildAttempt, findBuildingAttempt } from '../../_shared/studio-build-attempts';
import { readStudioGitBuild } from '../../_shared/studio-cloudflare-build';
import { STUDIO_CLOUDFLARE_TARGET } from '../../_shared/studio-cloudflare';
import { compileTorresArtifact, TORRES_SOURCE_COMMIT } from '../../_shared/studio-torres-artifact';
import { UUID, type PublishingEnv } from '../../_shared/studio-publisher';
import manifest from '../../../lib/canvas-manifest.json';

export interface StudioBuildInputEnv extends PublishingEnv { STUDIO_BUILD_INPUT_SECRET?: string }
async function authorized(request: Request, secret?: string) {
  if (!secret || !/^[A-Za-z0-9_-]{43,128}$/.test(secret) || request.headers.has('origin') || request.headers.has('cookie')) return false;
  const supplied = request.headers.get('authorization') ?? '';
  if (supplied.length > 160) return false;
  const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(supplied), digest('Bearer ' + secret)]);
  const left = new Uint8Array(a), right = new Uint8Array(b); let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/** Private build-to-server exchange. This separate credential cannot start builds,
 * change drafts, select a target, or access the permanent provider credential.
 * Keep unconfigured until the trusted build wrapper has been reviewed.
 */
export async function onRequest({ request, env }: { request: Request; env: StudioBuildInputEnv }): Promise<Response> {
  if (!await authorized(request, env.STUDIO_BUILD_INPUT_SECRET)) return authJson({ error: 'Unauthorized build.' }, 401);
  if (request.method !== 'POST') return authJson({ error: 'Unsupported method.' }, 405);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return authJson({ error: 'Invalid build request.' }, 415);
  if (!env.STUDIO_CLOUDFLARE_API_TOKEN) return authJson({ error: 'Build connection unavailable.' }, 503);
  try {
    const text = await request.text(); if (text.length > 1024) return authJson({ error: 'Invalid build request.' }, 413);
    const input = JSON.parse(text);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return authJson({ error: 'Invalid build request.' }, 400);
    }
    const keys = Object.keys(input).sort().join(',');
    let attempt;
    if (keys === 'attemptId,deploymentId' && typeof input.attemptId === 'string' && typeof input.deploymentId === 'string' && UUID.test(input.attemptId) && UUID.test(input.deploymentId)) {
      attempt = await getBuildAttempt(env, { id: input.attemptId, clientId: STUDIO_CLOUDFLARE_TARGET.client });
      if (attempt?.provider_deployment_id !== input.deploymentId) return authJson({ error: 'Build identity mismatch.' }, 409);
    } else if (keys === 'buildUrl,sourceCommit' && typeof input.buildUrl === 'string' && input.sourceCommit === TORRES_SOURCE_COMMIT) {
      const match = /^https:\/\/([a-f0-9]{8})\.torres-co-technology\.pages\.dev\/?$/.exec(input.buildUrl);
      if (!match) return authJson({ error: 'Invalid build request.' }, 400);
      attempt = await findBuildingAttempt(env, STUDIO_CLOUDFLARE_TARGET.client, match[1]);
    } else return authJson({ error: 'Invalid build request.' }, 400);
    if (!attempt || attempt.stage !== 'building' || !attempt.provider_deployment_id || attempt.source_commit !== TORRES_SOURCE_COMMIT ||
        !attempt.triggered_at || Date.now() - Date.parse(attempt.triggered_at) > 30 * 60 * 1000 || Date.parse(attempt.triggered_at) > Date.now()) {
      return authJson({ error: 'Build input is not available for this attempt.' }, 409);
    }
    // Read identity from the provider; environment variables supplied by a build
    // are not proof of which deployment is actually requesting the input.
    const observed = await readStudioGitBuild(env.STUDIO_CLOUDFLARE_API_TOKEN, attempt, attempt.provider_deployment_id);
    if (observed.outcome !== 'verified' || observed.deployment.state !== 'building') return authJson({ error: 'Build identity could not be verified.' }, 409);
    const { rest, headers } = studioStore(env);
    const read = async (path: string) => {
      const r = await fetch(rest + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw Error('Storage unavailable'); return r.json();
    };
    const [site] = await read('/studio_sites?client_id=eq.' + attempt.client_id + '&enabled=eq.true&publishing_enabled=eq.true&select=canvas_snapshot_id,public_url&limit=1');
    if (!site || site.canvas_snapshot_id !== manifest.id || site.public_url?.replace(/\/$/, '') !== manifest.source) return authJson({ error: 'Build enrollment unavailable.' }, 409);
    const [release] = await read('/studio_publications?id=eq.' + attempt.release_id + '&client_id=eq.' + attempt.client_id + '&select=id,snapshot_id,revision,content_hash,status&limit=1');
    if (!release || release.snapshot_id !== manifest.id || release.content_hash !== attempt.content_hash || !['queued','deploying','verifying'].includes(release.status)) return authJson({ error: 'Build publication unavailable.' }, 409);
    const [saved] = await read('/studio_canvas_drafts?client_id=eq.' + attempt.client_id + '&snapshot_id=eq.' + release.snapshot_id + '&revision=eq.' + release.revision + '&select=draft&limit=1');
    if (!saved) return authJson({ error: 'Saved revision unavailable.' }, 409);
    const artifact = await compileTorresArtifact({ releaseId: release.id, snapshotId: release.snapshot_id, revision: release.revision,
      contentHash: attempt.content_hash, sourceCommit: attempt.source_commit, draft: saved.draft });
    return authJson({ attemptId: attempt.id, deploymentId: attempt.provider_deployment_id, artifact });
  } catch {
    // Compiler failures may contain private draft values. Never expose/log them.
    return authJson({ error: 'The saved revision could not be prepared for this build.' }, 503);
  }
}
