import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ claim: vi.fn(), read: vi.fn(), advance: vi.fn(), start: vi.fn(), observe: vi.fn() }));
vi.mock('../functions/_shared/studio-build-attempts', () => ({ claimBuildAttempt: mocks.claim, getBuildAttempt: mocks.read, advanceBuildAttempt: mocks.advance }));
vi.mock('../functions/_shared/studio-cloudflare-build', () => ({ startStudioGitBuild: mocks.start, readStudioGitBuild: mocks.observe }));
import { dispatchStudioBuild, observeStudioBuild } from '../functions/_shared/studio-build-dispatch';
const scope = { id: '12345678-1234-4123-8123-123456789012', clientId: '06edc104-71e0-4359-8cb3-42529d65b5d1' };
const env = { STUDIO_CLOUDFLARE_API_TOKEN: 'server-only-test-credential' };
const attempt = { id: scope.id, client_id: scope.clientId, stage: 'triggering', triggered_at: '2026-11-10T20:00:00Z' };
beforeEach(() => { vi.resetAllMocks(); mocks.claim.mockResolvedValue(attempt); mocks.read.mockResolvedValue(attempt); });
describe('durable build dispatch', () => {
  it('requires the enrolled client before touching any storage or provider', async () => {
    await expect(dispatchStudioBuild(env, { ...scope, clientId: 'another-client' })).rejects.toThrow('unavailable');
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('does not retry creation after losing the claim response', async () => {
    mocks.claim.mockRejectedValue(Error('write uncertain'));
    await expect(dispatchStudioBuild(env, scope)).rejects.toThrow('uncertain');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('does not dispatch from an existing triggering row', async () => {
    mocks.claim.mockResolvedValue(null);
    expect(await dispatchStudioBuild(env, scope)).toEqual(attempt);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('records ambiguity instead of marking an uncertain deployment failed', async () => {
    mocks.start.mockResolvedValue({ outcome: 'ambiguous' });
    await dispatchStudioBuild(env, scope);
    expect(mocks.advance).toHaveBeenCalledWith(env, { ...scope, expectedStage: 'triggering', stage: 'ambiguous' });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it('records the provider identity and never retries after a lost write acknowledgment', async () => {
    mocks.start.mockResolvedValue({ outcome: 'accepted', deployment: { id: scope.id, state: 'succeeded' } });
    mocks.advance.mockRejectedValue(Error('write uncertain'));
    await expect(dispatchStudioBuild(env, scope)).rejects.toThrow('uncertain');
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.advance).toHaveBeenCalledWith(env, { ...scope, expectedStage: 'triggering', stage: 'building', providerDeploymentId: scope.id });
  });
  it('requires content verification even after Cloudflare reports success', async () => {
    mocks.read.mockResolvedValue({ ...attempt, stage: 'building', provider_deployment_id: scope.id });
    mocks.observe.mockResolvedValue({ outcome: 'verified', deployment: { id: scope.id, state: 'succeeded' } });
    const result = await observeStudioBuild(env, scope);
    expect(result.attempt?.stage).toBe('building'); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it('retains an ambiguous attempt when the provider cannot be read', async () => {
    mocks.read.mockResolvedValue({ ...attempt, stage: 'ambiguous', provider_deployment_id: scope.id });
    mocks.observe.mockResolvedValue({ outcome: 'unavailable' });
    expect((await observeStudioBuild(env, scope)).attempt?.stage).toBe('ambiguous');
    expect(mocks.advance).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('records independently confirmed provider failure', async () => {
    mocks.read.mockResolvedValue({ ...attempt, stage: 'building', provider_deployment_id: scope.id });
    mocks.observe.mockResolvedValue({ outcome: 'verified', deployment: { id: scope.id, state: 'failed' } });
    await observeStudioBuild(env, scope);
    expect(mocks.advance).toHaveBeenCalledWith(env, { ...scope, expectedStage: 'building', stage: 'failed', providerDeploymentId: scope.id });
  });
});
