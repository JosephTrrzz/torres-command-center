import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ attempt: vi.fn(), find: vi.fn(), provider: vi.fn(), compile: vi.fn() }));
vi.mock('../functions/_shared/studio-build-attempts', () => ({ getBuildAttempt: mocks.attempt, findBuildingAttempt: mocks.find }));
vi.mock('../functions/_shared/studio-cloudflare-build', () => ({ readStudioGitBuild: mocks.provider }));
vi.mock('../functions/_shared/studio-torres-artifact', () => ({ TORRES_SOURCE_COMMIT: 'a'.repeat(40), compileTorresArtifact: mocks.compile }));
import { onRequest } from '../functions/api/website/build-input';
import manifest from '../lib/canvas-manifest.json';
const id = '12345678-1234-4123-8123-123456789012';
const client = '06edc104-71e0-4359-8cb3-42529d65b5d1';
const secret = 'x'.repeat(43);
const env = { STUDIO_BUILD_INPUT_SECRET: secret, STUDIO_CLOUDFLARE_API_TOKEN: 'private-provider-token',
  SUPABASE_SERVICE_ROLE_KEY: 'private-database-token', SUPABASE_URL: 'https://mfdunybyzpfjqziygulk.supabase.co' };
const attempt = { id, client_id: client, release_id: id, content_hash: 'b'.repeat(64), source_commit: 'a'.repeat(40),
  stage: 'building', provider_deployment_id: id, triggered_at: new Date().toISOString() };
const request = (extra: Record<string,string> = {}, input: unknown = { attemptId: id, deploymentId: id }) => new Request('https://admin.torrescotechnology.com/api/website/build-input', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret, ...extra }, body: JSON.stringify(input),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.attempt.mockResolvedValue(attempt); mocks.find.mockResolvedValue(attempt);
  mocks.provider.mockResolvedValue({ outcome: 'verified', deployment: { state: 'building' } });
  mocks.compile.mockResolvedValue({ protocol: 1, script: 'validated artifact' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/studio_sites?')) return Response.json([{ canvas_snapshot_id: manifest.id, public_url: manifest.source }]);
    if (url.includes('/studio_publications?')) return Response.json([{ id, snapshot_id: manifest.id, revision: 36, content_hash: attempt.content_hash, status: 'queued' }]);
    if (url.includes('/studio_canvas_drafts?')) return Response.json([{ draft: { 0: {} } }]);
    throw Error('Unexpected request');
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe('private authenticated build input', () => {
  it('bootstraps only from the immutable Pages URL and pinned checkout', async () => {
    const response = await onRequest({ request: request({}, { buildUrl: 'https://12345678.torres-co-technology.pages.dev', sourceCommit: 'a'.repeat(40) }), env });
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith(env, client, '12345678');
    expect(mocks.provider).toHaveBeenCalledWith(env.STUDIO_CLOUDFLARE_API_TOKEN, attempt, id);
  });
  it.each(['https://torrescotechnology.com','https://main.torres-co-technology.pages.dev','https://12345678.torres-co-technology.pages.dev.evil.test','http://12345678.torres-co-technology.pages.dev'])('rejects alias and foreign build URLs', async buildUrl => {
    expect((await onRequest({ request: request({}, {buildUrl, sourceCommit: 'a'.repeat(40)}), env })).status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('does not release content before a matching build is recorded', async () => {
    mocks.find.mockResolvedValue(null);
    expect((await onRequest({ request: request({}, {buildUrl:'https://12345678.torres-co-technology.pages.dev',sourceCommit:'a'.repeat(40)}), env })).status).toBe(409);
    expect(mocks.compile).not.toHaveBeenCalled();
  });
  it.each<Record<string,string>>([{ Authorization: 'Bearer wrong' }, { Origin: 'https://admin.torrescotechnology.com' }, { Cookie: 'session=browser' }])('rejects browser or invalid credentials before reads', async headers => {
    expect((await onRequest({ request: request(headers), env })).status).toBe(401);
    expect(mocks.attempt).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('is closed by default with no build credential', async () => {
    expect((await onRequest({ request: request(), env: { ...env, STUDIO_BUILD_INPUT_SECRET: undefined } })).status).toBe(401);
  });
  it('rejects attempts to choose a different client or target', async () => {
    expect((await onRequest({ request: request({}, { attemptId: id, deploymentId: id, clientId: 'other' }), env })).status).toBe(400);
    expect(mocks.attempt).not.toHaveBeenCalled();
  });
  it.each([
    { ...attempt, stage: 'cancelled' }, { ...attempt, stage: 'succeeded' }, { ...attempt, source_commit: 'c'.repeat(40) },
    { ...attempt, provider_deployment_id: '87654321-1234-4123-8123-123456789012' },
    { ...attempt, triggered_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() },
  ])('rejects stale or mismatched attempts', async value => {
    mocks.attempt.mockResolvedValue(value);
    expect((await onRequest({ request: request(), env })).status).toBe(409);
    expect(mocks.compile).not.toHaveBeenCalled();
  });
  it('requires independent provider identity before reading saved content', async () => {
    mocks.provider.mockResolvedValue({ outcome: 'mismatch' });
    expect((await onRequest({ request: request(), env })).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns only the validated artifact for the exact immutable saved revision', async () => {
    const response = await onRequest({ request: request(), env }); expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toMatch(/private-|draft|supabase|xxxxxxxx/);
    expect(mocks.compile).toHaveBeenCalledWith({ releaseId: id, snapshotId: manifest.id, revision: 36,
      contentHash: attempt.content_hash, sourceCommit: attempt.source_commit, draft: { 0: {} } });
    expect(mocks.attempt).toHaveBeenCalledWith(env, { id, clientId: client });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('withholds private compiler failure details', async () => {
    mocks.compile.mockRejectedValue(Error('private draft content'));
    const response = await onRequest({ request: request(), env });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private draft content');
  });
});
