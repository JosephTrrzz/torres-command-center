import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advanceBuildAttempt, claimBuildAttempt, getBuildAttempt, findBuildingAttempt, reserveBuildAttempt,
  BuildAttemptWriteUncertain, type BuildAttempt, type PreviewEvidence, type ReserveBuildAttempt,
} from '../functions/_shared/studio-build-attempts';

const env = { SUPABASE_URL: 'https://storage.example', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key' };
const id = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const releaseId = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-11-10T00:00:00.000Z';
const input: ReserveBuildAttempt = {
  id, clientId, releaseId, contentHash: 'a'.repeat(64), sourceCommit: 'b'.repeat(40),
  environment: 'preview', branch: 'codex/studio-publish-preview',
};
const reserved: BuildAttempt = {
  id, client_id: clientId, release_id: releaseId, content_hash: input.contentHash, source_commit: input.sourceCommit,
  environment: 'preview', branch: input.branch, stage: 'reserved', provider_deployment_id: null,
  previous_production_deployment_id: null, preview_attempt_id: null, preview_evidence: null,
  created_at: timestamp, triggered_at: null, updated_at: timestamp,
};
const triggering = { ...reserved, stage: 'triggering' as const, triggered_at: timestamp };
const proof: PreviewEvidence = { deployment_id: 'provider-1', artifact_hash: 'c'.repeat(64), verified_at: timestamp,
  routes_verified: true, runtime_verified: true, functional_verified: true };
const fetcher = vi.fn();
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => vi.unstubAllGlobals());

describe('durable build attempt transport', () => {
  it('reads cancelled previews without provider identity and strips operator audit fields',async()=>{
    fetcher.mockResolvedValue(json([{...reserved,stage:'cancelled',cancellation_reason:'operator audit'}]));
    expect(await getBuildAttempt(env,{id,clientId})).toEqual({...reserved,stage:'cancelled'});
    fetcher.mockResolvedValue(json([{...triggering,stage:'cancelled',environment:'production',branch:'main'}]));
    await expect(getBuildAttempt(env,{id,clientId})).rejects.toThrow('Invalid');
  });
  it('resolves only the recorded immutable deployment prefix for the fixed client', async () => {
    const building = {...triggering, stage:'building' as const,provider_deployment_id:other};
    fetcher.mockResolvedValue(json([building]));
    expect(await findBuildingAttempt(env,clientId,'44444444')).toEqual(building);
    expect(fetcher.mock.calls[0][0]).toContain('client_id=eq.'+clientId+'&stage=eq.building&limit=2');
    fetcher.mockResolvedValue(json([building]));
    expect(await findBuildingAttempt(env,clientId,'55555555')).toBeNull();
  });
  it('rejects multiple active rows instead of choosing a build', async () => {
    fetcher.mockResolvedValue(json([reserved,reserved]));
    await expect(findBuildingAttempt(env,clientId,'44444444')).rejects.toThrow('Ambiguous');
  });
  it('reserves exact immutable identity through service-only RPC without provider calls', async () => {
    fetcher.mockResolvedValue(json(reserved));
    expect(await reserveBuildAttempt(env, input)).toEqual(reserved);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://storage.example/rest/v1/rpc/studio_reserve_build_attempt');
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer private-test-key' } });
    expect(JSON.parse(options.body)).toEqual({ p_id: id, p_client: clientId, p_release: releaseId,
      p_hash: input.contentHash, p_source: input.sourceCommit, p_environment: 'preview', p_branch: input.branch,
      p_preview: null, p_previous_production: null });
  });

  it('requires production preview reference and rollback identity, leaving evidence copying to SQL', async () => {
    const production = { ...input, environment: 'production' as const, branch: 'main',
      previewAttemptId: other, previousProductionDeploymentId: 'last-production' };
    const result = { ...reserved, environment: 'production', branch: 'main', preview_attempt_id: other,
      previous_production_deployment_id: 'last-production', preview_evidence: proof };
    fetcher.mockResolvedValue(json(result));
    expect(await reserveBuildAttempt(env, production)).toEqual(result);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ p_preview: other, p_previous_production: 'last-production' });
    expect(body).not.toHaveProperty('p_evidence');
  });

  it.each([
    { sourceCommit: 'HEAD' }, { contentHash: 'bad' }, { releaseId: 'foreign&scope=all' },
    { branch: 'main' }, { environment: 'production', branch: 'main' },
    { previewAttemptId: other }, { previousProductionDeploymentId: 'unexpected' },
  ])('rejects malformed reservation before storage: %j', async patch => {
    await expect(reserveBuildAttempt(env, { ...input, ...patch } as ReserveBuildAttempt)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['release_id', 'content_hash', 'source_commit'] as const)('rejects reserve response with a different %s', async field => {
    fetcher.mockResolvedValue(json({ ...reserved, [field]: field === 'release_id' ? other : 'd'.repeat(field === 'content_hash' ? 64 : 40) }));
    await expect(reserveBuildAttempt(env, input)).rejects.toBeInstanceOf(BuildAttemptWriteUncertain);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads only the requested client/attempt and strips future private columns', async () => {
    fetcher.mockResolvedValue(json([{ ...reserved, private_metadata: { secret: 'must-not-leave' } }]));
    expect(await getBuildAttempt(env, { id, clientId })).toEqual(reserved);
    expect(fetcher.mock.calls[0][0]).toBe(`https://storage.example/rest/v1/studio_build_attempts?client_id=eq.${clientId}&id=eq.${id}&limit=1`);
  });
  it('rejects a cross-client response even from storage', async () => {
    fetcher.mockResolvedValue(json([{ ...reserved, client_id: other }]));
    await expect(getBuildAttempt(env, { id, clientId })).rejects.toThrow('Invalid');
  });
  it('returns null for a missing scoped attempt', async () => {
    fetcher.mockResolvedValue(json([]));
    expect(await getBuildAttempt(env, { id, clientId })).toBeNull();
  });
  it('does not interpret a read failure as missing', async () => {
    fetcher.mockResolvedValue(new Response('private database details', { status: 500 }));
    await expect(getBuildAttempt(env, { id, clientId })).rejects.toThrow('Build attempt could not be read.');
  });
  it('fails before transport without service credentials', async () => {
    await expect(claimBuildAttempt({}, { id, clientId })).rejects.toThrow('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('claim and state updates never repeat uncertain mutations', () => {
  it('returns a persisted triggering claim with the database trigger time', async () => {
    fetcher.mockResolvedValue(json([triggering]));
    expect(await claimBuildAttempt(env, { id, clientId })).toEqual(triggering);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_id: id, p_client: clientId });
  });
  it('returns no dispatch permission for an already claimed attempt', async () => {
    fetcher.mockResolvedValue(json([]));
    expect(await claimBuildAttempt(env, { id, clientId })).toBeNull();
  });
  it.each([reserved, { ...triggering, triggered_at: null }, { ...triggering, stage: 'ambiguous' }])('rejects an invalid claim response', async result => {
    fetcher.mockResolvedValue(json([result]));
    await expect(claimBuildAttempt(env, { id, clientId })).rejects.toBeInstanceOf(BuildAttemptWriteUncertain);
  });
  it.each(['timeout', 'http', 'json'] as const)('does not retry or leak a %s claim failure', async failure => {
    if (failure === 'timeout') fetcher.mockRejectedValue(Error('private-test-key'));
    else fetcher.mockResolvedValue(new Response('private-test-key', { status: failure === 'http' ? 503 : 200 }));
    await expect(claimBuildAttempt(env, { id, clientId })).rejects.toThrow('Read the existing attempt');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('records ambiguity without inventing provider identity or releasing the lock', async () => {
    fetcher.mockResolvedValue(json([{ ...triggering, stage: 'ambiguous' }]));
    expect(await advanceBuildAttempt(env, { id, clientId, expectedStage: 'triggering', stage: 'ambiguous' })).toMatchObject({ stage: 'ambiguous', provider_deployment_id: null });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_id: id, p_client: clientId,
      p_expected: 'triggering', p_stage: 'ambiguous', p_provider: null, p_evidence: null });
  });
  it('records provider identity with a compare-and-set transition', async () => {
    fetcher.mockResolvedValue(json([{ ...triggering, stage: 'building', provider_deployment_id: 'provider-1' }]));
    expect(await advanceBuildAttempt(env, { id, clientId, expectedStage: 'triggering', stage: 'building', providerDeploymentId: 'provider-1' })).toMatchObject({ stage: 'building' });
  });
  it('returns null for a stale transition', async () => {
    fetcher.mockResolvedValue(json([]));
    expect(await advanceBuildAttempt(env, { id, clientId, expectedStage: 'triggering', stage: 'ambiguous' })).toBeNull();
  });
  it.each([{ stage: 'ambiguous' }, { stage: 'building', provider_deployment_id: 'different' }])('rejects a mismatched advancement result', async patch => {
    fetcher.mockResolvedValue(json([{ ...triggering, ...patch }]));
    await expect(advanceBuildAttempt(env, { id, clientId, expectedStage: 'triggering', stage: 'building', providerDeploymentId: 'provider-1' })).rejects.toBeInstanceOf(BuildAttemptWriteUncertain);
  });
  it('rejects incomplete evidence before writing', async () => {
    await expect(advanceBuildAttempt(env, { id, clientId, expectedStage: 'building', stage: 'succeeded', previewEvidence: { ...proof, runtime_verified: null } as unknown as PreviewEvidence })).rejects.toThrow('Invalid preview');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('records only allowlisted preview evidence', async () => {
    fetcher.mockResolvedValue(json([{ ...triggering, stage: 'succeeded', provider_deployment_id: proof.deployment_id, preview_evidence: proof }]));
    expect(await advanceBuildAttempt(env, { id, clientId, expectedStage: 'building', stage: 'succeeded', previewEvidence: proof })).toMatchObject({ preview_evidence: proof });
  });
});
