import { getBuildAttempt, type BuildAttemptScope } from './studio-build-attempts';
import { readStudioGitBuild } from './studio-cloudflare-build';
import { STUDIO_CLOUDFLARE_TARGET as target } from './studio-cloudflare';
import { UUID, canonical, type PublishingEnv } from './studio-publisher';

const base = `https://api.cloudflare.com/client/v4/accounts/${target.account}/pages/projects/${target.project}`;
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : {};
export type StudioRecoveryIdentity = {
  attemptId: string; clientId: string; releaseId: string; contentHash: string;
  productionDeploymentId: string; sourceCommit: string;
  previousProductionDeploymentId: string; previousSourceCommit: string;
};
export type StudioRecoveryObservation = {
  outcome: 'production_current' | 'previous_current'; identity: StudioRecoveryIdentity;
};
export interface StudioRecoveryControl {
  /** Mandatory durable, non-replayable operator authorization. Atomically record
   * this exact identity and exclude concurrent production dispatch/recovery BEFORE
   * returning true. False/throw/lost acknowledgment never permits a provider write.
   * An existing claim MUST return false, including after timeout or process crash.
   * Keep the lock until an operator reconciles it; do not use an expiring lease.
   * The caller must also freeze out-of-band Git/provider production deployments.
   * This port is intentionally not implemented as an in-memory flag or endpoint. */
  claimOnce(identity: Readonly<StudioRecoveryIdentity>): Promise<boolean>;
  /** Persist only this allowlisted result. Failure to persist remains ambiguous. */
  record(identity: Readonly<StudioRecoveryIdentity>, outcome: 'ambiguous' | 'blocked' | 'provider_restored'): Promise<void>;
}

// Provider bodies can include secrets; bound them and never return/log raw data.
async function json(response: Response): Promise<ObjectValue> {
  if (!response.ok) throw Error('Provider unavailable');
  const reader = response.body?.getReader(); if (!reader) throw Error('Provider unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 1048576) throw Error('Provider unavailable');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = object(JSON.parse(new TextDecoder().decode(bytes)));
  if (body.success !== true) throw Error('Provider unavailable');
  return object(body.result);
}
async function read(token: string, path: string) {
  return json(await fetch(base + path, { headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual', signal: AbortSignal.timeout(8000) }));
}

/** Read-only reconciliation. previous_current proves provider routing only. It
 * does not prove that this helper performed a rollback, public bytes are healthy,
 * or rollback enrollment is ready. No publishing-enabled gate: recovery must
 * remain possible after an operator disables publishing during an incident. */
export async function observeStudioProductionRecovery(env: PublishingEnv, scope: BuildAttemptScope): Promise<StudioRecoveryObservation | {outcome: 'blocked' | 'unavailable'}> {
  if (!scope || scope.clientId !== target.client || !UUID.test(scope.id)
    || !env.STUDIO_CLOUDFLARE_API_TOKEN || env.STUDIO_CLOUDFLARE_API_TOKEN.length < 20
    || /[\r\n]/.test(env.STUDIO_CLOUDFLARE_API_TOKEN)) return { outcome: 'blocked' };
  try {
    const a = await getBuildAttempt(env, scope);
    if (!a || a.id !== scope.id || a.client_id !== target.client || a.environment !== 'production' || a.branch !== 'main'
      || !['building','succeeded','failed','ambiguous'].includes(a.stage)
      || !a.provider_deployment_id || !UUID.test(a.provider_deployment_id)
      || !a.previous_production_deployment_id || !UUID.test(a.previous_production_deployment_id)
      || a.previous_production_deployment_id === a.provider_deployment_id) return { outcome: 'blocked' };
    const token = env.STUDIO_CLOUDFLARE_API_TOKEN;
    const previous = await read(token, '/deployments/' + a.previous_production_deployment_id);
    const commit = object(object(previous.deployment_trigger).metadata).commit_hash;
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) return { outcome: 'blocked' };
    // The baseline commit is read from the exact ledger target, never supplied by
    // an operator request. Existing strict provider validation checks main,
    // production, project, immutable URL, clean source and successful final state.
    const verified = await readStudioGitBuild(token, {id:a.id,source_commit:commit,environment:'production',branch:'main'}, a.previous_production_deployment_id);
    if (verified.outcome !== 'verified' || verified.deployment.state !== 'succeeded') return { outcome: 'blocked' };
    const project = await read(token, '');
    const current = object(project.canonical_deployment);
    const currentCommit = object(object(current.deployment_trigger).metadata).commit_hash;
    if (project.name !== target.project || project.production_branch !== 'main' || !Array.isArray(project.domains)
      || !project.domains.includes(target.hostname) || current.environment !== 'production') return { outcome: 'blocked' };
    const isPrevious = current.id === a.previous_production_deployment_id && currentCommit === commit;
    if (!isPrevious && (current.id !== a.provider_deployment_id || currentCommit !== a.source_commit)) return { outcome: 'blocked' };
    if (!isPrevious) {
      const production = await readStudioGitBuild(token, {id:a.id,source_commit:a.source_commit,environment:'production',branch:'main'}, a.provider_deployment_id);
      if (production.outcome !== 'verified' || production.deployment.state !== 'succeeded') return { outcome: 'blocked' };
    }
    return { outcome: isPrevious ? 'previous_current' : 'production_current', identity: {
      attemptId:a.id,clientId:a.client_id,releaseId:a.release_id,contentHash:a.content_hash,
      productionDeploymentId:a.provider_deployment_id,sourceCommit:a.source_commit,
      previousProductionDeploymentId:a.previous_production_deployment_id,previousSourceCommit:commit,
    } };
  } catch { return { outcome: 'unavailable' }; }
}

/** Internal operator-only use after authentication/authorization, never a public
 * endpoint. Uses the server-stored token and ledger target exclusively. One POST
 * maximum; any uncertain mutation is reconciled with observe..., never replayed.
 * Cloudflare has no compare-and-swap rollback API: a durable claim plus a freeze
 * of external production writers is required. This helper does not enable sites,
 * rewrite publication history, manufacture browser evidence or set capabilities. */
export async function recoverStudioProduction(env: PublishingEnv, scope: BuildAttemptScope, control: StudioRecoveryControl) {
  if (!control || typeof control.claimOnce !== 'function' || typeof control.record !== 'function') return { outcome: 'blocked' as const };
  const before = await observeStudioProductionRecovery(env, scope);
  if (before.outcome !== 'production_current') return before;
  const identity = Object.freeze({ ...before.identity });
  try {
    if (await control.claimOnce(identity) !== true) return { outcome: 'already_claimed' as const };
  } catch { return { outcome: 'ambiguous' as const }; }
  async function recorded(outcome: 'ambiguous' | 'blocked' | 'provider_restored') {
    try { await control.record(identity, outcome); return { outcome, identity }; }
    catch { return { outcome: 'ambiguous' as const }; }
  }
  // Re-read the durable attempt and live provider identity after acquiring the
  // operator claim, so a stale inspection never directly authorizes mutation.
  const current = await observeStudioProductionRecovery(env, scope);
  if (current.outcome !== 'production_current' || canonical(current.identity) !== canonical(identity)) return recorded('blocked');
  try {
    const result = await json(await fetch(base + '/deployments/' + identity.previousProductionDeploymentId + '/rollback', {
      method:'POST',headers:{Authorization:`Bearer ${env.STUDIO_CLOUDFLARE_API_TOKEN}`},
      redirect:'manual',signal:AbortSignal.timeout(15000),
    }));
    if (result.id !== identity.previousProductionDeploymentId) return recorded('ambiguous');
  } catch { return recorded('ambiguous'); }
  const after = await observeStudioProductionRecovery(env, scope);
  return recorded(after.outcome === 'previous_current' && canonical(after.identity) === canonical(identity)
    ? 'provider_restored' : 'ambiguous');
}
