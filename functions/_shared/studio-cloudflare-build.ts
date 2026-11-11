import { STUDIO_CLOUDFLARE_TARGET as target } from './studio-cloudflare';
import { UUID } from './studio-publisher';

// Operator-controlled branches. Never derive these from a browser request.
export const STUDIO_BUILD_BRANCHES = Object.freeze({ preview: 'codex/studio-publish-preview', production: 'main' });
const base = `https://api.cloudflare.com/client/v4/accounts/${target.account}/pages/projects/${target.project}`;
export type BuildIdentity = { id: string; source_commit: string; environment: 'preview'|'production'; branch: string };
export type DeploymentEvidence = {
  id: string; sourceCommit: string; environment: 'preview'|'production'; branch: string;
  url: string; createdAt: string; state: 'building'|'succeeded'|'failed';
};
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}
function valid(identity: BuildIdentity) {
  return UUID.test(identity.id) && /^[a-f0-9]{40}$/.test(identity.source_commit) &&
    Object.hasOwn(STUDIO_BUILD_BRANCHES, identity.environment) && identity.branch === STUDIO_BUILD_BRANCHES[identity.environment];
}
function credential(token: string) { return token.length >= 20 && !/[\r\n]/.test(token); }

// Cloudflare responses contain environment secrets. Only this allowlisted evidence
// can leave the provider boundary; never log or return the response object.
function evidence(value: unknown, expected: BuildIdentity, deploymentId?: string): DeploymentEvidence | null {
  const d = object(value), trigger = object(d.deployment_trigger), meta = object(trigger.metadata), stage = object(d.latest_stage);
  if (typeof d.id !== 'string' || !UUID.test(d.id) || (deploymentId && d.id !== deploymentId) ||
      d.project_name !== target.project || d.environment !== expected.environment ||
      meta.branch !== expected.branch || meta.commit_hash !== expected.source_commit || meta.commit_dirty !== false ||
      d.is_skipped !== false || typeof d.created_on !== 'string' || !Number.isFinite(Date.parse(d.created_on))) return null;
  let url: URL;
  try { url = new URL(String(d.url)); } catch { return null; }
  // Only immutable deployment URLs, not aliases or arbitrary provider-returned URLs.
  if (url.protocol !== 'https:' || url.hostname !== `${d.id.slice(0, 8)}.${target.project}.pages.dev` ||
      url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
  const names = ['queued','initialize','clone_repo','build','deploy'];
  const statuses = ['idle','active','success','failure','canceled'];
  if (!names.includes(String(stage.name)) || !statuses.includes(String(stage.status))) return null;
  const state = ['failure','canceled'].includes(String(stage.status)) ? 'failed'
    : stage.name === 'deploy' && stage.status === 'success' ? 'succeeded' : 'building';
  return { id: d.id, sourceCommit: expected.source_commit, environment: expected.environment,
    branch: expected.branch, url: url.origin, createdAt: d.created_on, state };
}
async function body(response: Response): Promise<Json> {
  // Project configuration can be large. Bound bytes before JSON parsing.
  const reader = response.body?.getReader(); if (!reader) throw Error('Missing response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 1048576) throw Error('Response too large');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return object(JSON.parse(new TextDecoder().decode(all)));
}

/** This method deliberately never retries. Persist triggering BEFORE calling it.
 * Any uncertain result keeps the database attempt locked for reconciliation.
 * commit_hash is intentionally NOT sent: it is metadata, not a checkout pin.
 * The build wrapper must independently reject checkout/source drift.
 */
export async function startStudioGitBuild(token: string, attempt: BuildIdentity & { state: 'triggering'; triggered_at: string }) {
  if (!credential(token) || !valid(attempt) || attempt.state !== 'triggering' || !Number.isFinite(Date.parse(attempt.triggered_at))) {
    return { outcome: 'invalid' as const };
  }
  const form = new FormData(); form.set('branch', attempt.branch);
  form.set('commit_message', `Torres Studio attempt ${attempt.id}`);
  try {
    const response = await fetch(base + '/deployments', { method: 'POST',
      headers: { Authorization: `Bearer ${token}` }, body: form,
      redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { outcome: 'ambiguous' as const };
    const data = await body(response);
    const deployment = data.success === true ? evidence(data.result, attempt) : null;
    if (!deployment || Date.parse(deployment.createdAt) < Date.parse(attempt.triggered_at) - 30000) return { outcome: 'ambiguous' as const };
    return { outcome: 'accepted' as const, deployment };
  } catch { return { outcome: 'ambiguous' as const }; }
}

export async function readStudioGitBuild(token: string, expected: BuildIdentity, deploymentId: string) {
  if (!credential(token) || !valid(expected) || !UUID.test(deploymentId)) return { outcome: 'invalid' as const };
  try {
    const response = await fetch(base + '/deployments/' + deploymentId, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
    // Even a 404 does not prove an ambiguous creation failed; never unlock here.
    if (!response.ok) return { outcome: 'unavailable' as const };
    const data = await body(response);
    const deployment = data.success === true ? evidence(data.result, expected, deploymentId) : null;
    return deployment ? { outcome: 'verified' as const, deployment } : { outcome: 'mismatch' as const };
  } catch { return { outcome: 'unavailable' as const }; }
}
