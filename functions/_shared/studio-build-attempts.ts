import type { FunctionEnv } from './auth';
import { studioStore } from './studio-access';
import { UUID } from './studio-publisher';

export type BuildStage = 'reserved' | 'triggering' | 'building' | 'succeeded' | 'failed' | 'ambiguous';
export type BuildEnvironment = 'preview' | 'production';
export type PreviewEvidence = {
  deployment_id: string; artifact_hash: string; verified_at: string;
  routes_verified: true; runtime_verified: true; functional_verified: true;
};
export type BuildAttempt = {
  id: string; release_id: string; client_id: string; content_hash: string; source_commit: string;
  environment: BuildEnvironment; branch: string; stage: BuildStage;
  provider_deployment_id: string | null; previous_production_deployment_id: string | null;
  preview_attempt_id: string | null; preview_evidence: PreviewEvidence | null;
  created_at: string; triggered_at: string | null; updated_at: string;
};
export type BuildAttemptScope = { id: string; clientId: string };
export type ReserveBuildAttempt = BuildAttemptScope & {
  releaseId: string; contentHash: string; sourceCommit: string; environment: BuildEnvironment; branch: string;
  previewAttemptId?: string; previousProductionDeploymentId?: string;
};
export type AdvanceBuildAttempt = BuildAttemptScope & {
  expectedStage: BuildStage; stage: 'building' | 'succeeded' | 'failed' | 'ambiguous';
  providerDeploymentId?: string; previewEvidence?: PreviewEvidence;
};
export class BuildAttemptWriteUncertain extends Error {
  constructor() { super('Build attempt write was not confirmed. Read the existing attempt; do not repeat deployment creation.'); }
}
const hash = /^[a-f0-9]{64}$/;
const providerId = /^[a-zA-Z0-9_-]{1,160}$/;
const stages: BuildStage[] = ['reserved','triggering','building','succeeded','failed','ambiguous'];
const branches = { preview: 'codex/studio-publish-preview', production: 'main' } as const;
function scope(input: BuildAttemptScope) {
  if (!UUID.test(input.id) || !UUID.test(input.clientId)) throw Error('Invalid build attempt scope.');
}
function evidence(value: PreviewEvidence) {
  if (!value || Object.keys(value).sort().join(',') !== 'artifact_hash,deployment_id,functional_verified,routes_verified,runtime_verified,verified_at'
    || !providerId.test(value.deployment_id) || !hash.test(value.artifact_hash)
    || typeof value.verified_at !== 'string' || !Number.isFinite(Date.parse(value.verified_at))
    || value.routes_verified !== true || value.runtime_verified !== true || value.functional_verified !== true) {
    throw Error('Invalid preview evidence.');
  }
}
// Never surface the PostgREST body: it may contain private inputs. Never retry a
// mutation, including a claim whose committed response was lost in transit.
async function transport(env: FunctionEnv, path: string, body?: object): Promise<unknown> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Build attempt storage is unavailable.');
  const { rest, headers } = studioStore(env);
  try {
    const response = await fetch(rest + path, {
      method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error('Storage request failed.');
    return await response.json();
  } catch {
    if (body) throw new BuildAttemptWriteUncertain();
    throw Error('Build attempt could not be read.');
  }
}
function row(value: unknown, input: BuildAttemptScope): BuildAttempt {
  const a = value as BuildAttempt | null;
  if (!a || a.id !== input.id || a.client_id !== input.clientId || !UUID.test(a.release_id)
    || !hash.test(a.content_hash) || !/^[a-f0-9]{40}$/.test(a.source_commit)
    || !Object.hasOwn(branches, a.environment) || a.branch !== branches[a.environment] || !stages.includes(a.stage)
    || ![a.created_at, a.updated_at].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v)))
    || !(a.triggered_at === null || typeof a.triggered_at === 'string' && Number.isFinite(Date.parse(a.triggered_at)))
    || !(a.provider_deployment_id === null || typeof a.provider_deployment_id === 'string' && providerId.test(a.provider_deployment_id))
    || !(a.previous_production_deployment_id === null || typeof a.previous_production_deployment_id === 'string' && providerId.test(a.previous_production_deployment_id))
    || !(a.preview_attempt_id === null || typeof a.preview_attempt_id === 'string' && UUID.test(a.preview_attempt_id))
    || (a.stage !== 'reserved' && a.stage !== 'failed' && (!a.triggered_at || !Number.isFinite(Date.parse(a.triggered_at))))) {
    throw Error('Invalid build attempt storage response.');
  }
  if (a.preview_evidence !== null) evidence(a.preview_evidence);
  // Explicit projection: future private ledger columns must never escape by accident.
  return {
    id: a.id, release_id: a.release_id, client_id: a.client_id, content_hash: a.content_hash,
    source_commit: a.source_commit, environment: a.environment, branch: a.branch, stage: a.stage,
    provider_deployment_id: a.provider_deployment_id, previous_production_deployment_id: a.previous_production_deployment_id,
    preview_attempt_id: a.preview_attempt_id, preview_evidence: a.preview_evidence ? { ...a.preview_evidence } : null,
    created_at: a.created_at, triggered_at: a.triggered_at, updated_at: a.updated_at,
  };
}
async function mutation(env: FunctionEnv, name: string, body: object, input: BuildAttemptScope, optional: boolean) {
  const result = await transport(env, '/rpc/' + name, body);
  try {
    if (optional && Array.isArray(result) && result.length === 0) return null;
    if (Array.isArray(result) && result.length !== 1) throw Error('Unexpected rows.');
    return row(Array.isArray(result) ? result[0] : result, input);
  } catch { throw new BuildAttemptWriteUncertain(); }
}

/** Call only after authorization and release validation. IDs are generated by the
 * server and reused to recover reservation responses, never replaced on timeout. */
export async function reserveBuildAttempt(env: FunctionEnv, input: ReserveBuildAttempt): Promise<BuildAttempt> {
  scope(input);
  if (!UUID.test(input.releaseId) || !hash.test(input.contentHash) || !/^[a-f0-9]{40}$/.test(input.sourceCommit)
    || !Object.hasOwn(branches, input.environment) || input.branch !== branches[input.environment]
    || (input.environment === 'production'
      ? !input.previewAttemptId || !UUID.test(input.previewAttemptId) || !input.previousProductionDeploymentId || !providerId.test(input.previousProductionDeploymentId)
      : input.previewAttemptId !== undefined || input.previousProductionDeploymentId !== undefined)) throw Error('Invalid build reservation.');
  const saved = (await mutation(env, 'studio_reserve_build_attempt', {
    p_id: input.id, p_release: input.releaseId, p_client: input.clientId, p_hash: input.contentHash,
    p_source: input.sourceCommit, p_environment: input.environment, p_branch: input.branch,
    p_preview: input.previewAttemptId ?? null, p_previous_production: input.previousProductionDeploymentId ?? null,
  }, input, false))!;
  if (saved.release_id !== input.releaseId || saved.content_hash !== input.contentHash || saved.source_commit !== input.sourceCommit
    || saved.environment !== input.environment || saved.branch !== input.branch
    || saved.preview_attempt_id !== (input.previewAttemptId ?? null)
    || saved.previous_production_deployment_id !== (input.previousProductionDeploymentId ?? null)) throw new BuildAttemptWriteUncertain();
  return saved;
}

export async function getBuildAttempt(env: FunctionEnv, input: BuildAttemptScope): Promise<BuildAttempt | null> {
  scope(input);
  const result = await transport(env, '/studio_build_attempts?client_id=eq.' + input.clientId + '&id=eq.' + input.id + '&limit=1');
  if (!Array.isArray(result) || result.length > 1) throw Error('Invalid build attempt storage response.');
  return result.length ? row(result[0], input) : null;
}

/** Resolve a Pages build's immutable short URL without trusting a client-selected
 * attempt. The deployment ID is still verified independently against Cloudflare. */
export async function findBuildingAttempt(env: FunctionEnv, clientId: string, deploymentPrefix: string): Promise<BuildAttempt | null> {
  if (!UUID.test(clientId) || !/^[a-f0-9]{8}$/.test(deploymentPrefix)) throw Error('Invalid build lookup.');
  const result = await transport(env, '/studio_build_attempts?client_id=eq.' + clientId + '&stage=eq.building&limit=2');
  if (!Array.isArray(result) || result.length > 1) throw Error('Ambiguous build lookup.');
  if (!result.length) return null;
  const candidate = result[0] as BuildAttempt;
  if (!UUID.test(candidate.id)) throw Error('Invalid build lookup response.');
  const checked = row(candidate, {id: candidate.id, clientId});
  return checked.provider_deployment_id?.startsWith(deploymentPrefix + '-') ? checked : null;
}

/** Only this successful call grants permission for ONE create API invocation.
 * Reading a triggering row later never grants permission to dispatch again. */
export async function claimBuildAttempt(env: FunctionEnv, input: BuildAttemptScope): Promise<(BuildAttempt & { stage: 'triggering'; triggered_at: string }) | null> {
  scope(input);
  const claimed = await mutation(env, 'studio_claim_build_attempt', { p_id: input.id, p_client: input.clientId }, input, true);
  if (!claimed) return null;
  if (claimed.stage !== 'triggering' || !claimed.triggered_at) throw new BuildAttemptWriteUncertain();
  return claimed as BuildAttempt & { stage: 'triggering'; triggered_at: string };
}

/** Supply terminal status only from verified provider observations, not network
 * errors/404s. Preview success additionally requires actual browser evidence. */
export async function advanceBuildAttempt(env: FunctionEnv, input: AdvanceBuildAttempt): Promise<BuildAttempt | null> {
  scope(input);
  if (!stages.includes(input.expectedStage) || !['building','succeeded','failed','ambiguous'].includes(input.stage)
    || (input.providerDeploymentId !== undefined && !providerId.test(input.providerDeploymentId))) throw Error('Invalid build transition.');
  if (input.previewEvidence !== undefined) evidence(input.previewEvidence);
  const saved = await mutation(env, 'studio_advance_build_attempt', {
    p_id: input.id, p_client: input.clientId, p_expected: input.expectedStage, p_stage: input.stage,
    p_provider: input.providerDeploymentId ?? null, p_evidence: input.previewEvidence ?? null,
  }, input, true);
  if (saved && (saved.stage !== input.stage
    || input.providerDeploymentId !== undefined && saved.provider_deployment_id !== input.providerDeploymentId
    || input.previewEvidence !== undefined && Object.entries(input.previewEvidence).some(([k,v]) => saved.preview_evidence?.[k as keyof PreviewEvidence] !== v))) {
    throw new BuildAttemptWriteUncertain();
  }
  return saved;
}
