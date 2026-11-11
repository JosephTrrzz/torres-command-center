import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStudioGitBuild, startStudioGitBuild, STUDIO_BUILD_BRANCHES } from '../functions/_shared/studio-cloudflare-build';
const token = 'test-server-only-publishing-token';
const id = '12345678-1234-4123-8123-123456789012';
const attempt = { id, source_commit: 'a'.repeat(40), environment: 'preview' as const,
  branch: STUDIO_BUILD_BRANCHES.preview, state: 'triggering' as const, triggered_at: '2026-11-10T20:00:00Z' };
const deployment = { id, project_name: 'torres-co-technology', environment: 'preview', is_skipped: false,
  url: 'https://12345678.torres-co-technology.pages.dev', created_on: attempt.triggered_at,
  deployment_trigger: { metadata: { branch: attempt.branch, commit_hash: attempt.source_commit, commit_dirty: false } },
  latest_stage: { name: 'build', status: 'active' }, env_vars: { SECRET: { value: 'must-not-leak' } } };
afterEach(() => vi.unstubAllGlobals());
function respond(value = deployment) {
  const fetcher = vi.fn(async () => Response.json({ success: true, result: value }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
describe('enrolled Cloudflare build boundary', () => {
  it('triggers only the fixed target and approved branch without pretending a metadata SHA pins checkout', async () => {
    const fetcher = respond(); const result = await startStudioGitBuild(token, attempt);
    expect(result.outcome).toBe('accepted');
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/bdecd4f5c86e75b33b31738dd5837947/pages/projects/torres-co-technology/deployments');
    const form = options.body as FormData;
    expect(form.get('branch')).toBe(attempt.branch); expect(form.has('commit_hash')).toBe(false);
    expect(options.redirect).toBe('manual');
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|env_vars|test-server-only/);
  });
  it.each(['other-branch', 'main', '../main'])('refuses unapproved preview branch %s without a request', async branch => {
    const fetcher = respond(); expect((await startStudioGitBuild(token, { ...attempt, branch })).outcome).toBe('invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([301, 401, 403, 429, 500])('never retries or unlocks an uncertain mutation response %i', async status => {
    const fetcher = vi.fn(async () => new Response('private provider detail', { status })); vi.stubGlobal('fetch', fetcher);
    expect(await startStudioGitBuild(token, attempt)).toEqual({ outcome: 'ambiguous' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves ambiguity after a timeout without exposing the secret', async () => {
    const fetcher = vi.fn(async () => { throw Error(token); }); vi.stubGlobal('fetch', fetcher);
    expect(await startStudioGitBuild(token, attempt)).toEqual({ outcome: 'ambiguous' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...deployment, project_name: 'another-client' },
    { ...deployment, environment: 'production' },
    { ...deployment, url: 'https://evil.example/' },
    { ...deployment, url: 'https://main.torres-co-technology.pages.dev' },
    { ...deployment, url: deployment.url + '/?secret=1' },
    { ...deployment, is_skipped: true },
    { ...deployment, deployment_trigger: { metadata: { ...deployment.deployment_trigger.metadata, commit_hash: 'b'.repeat(40) } } },
    { ...deployment, latest_stage: { name: 'unknown', status: 'success' } },
  ])('rejects mismatched provider identity and unknown status', async value => {
    respond(value); expect((await readStudioGitBuild(token, attempt, id)).outcome).toBe('mismatch');
  });
  it('does not equate a successful build stage with a deployed site', async () => {
    respond({ ...deployment, latest_stage: { name: 'build', status: 'success' } });
    expect(await readStudioGitBuild(token, attempt, id)).toMatchObject({ outcome: 'verified', deployment: { state: 'building' } });
    respond({ ...deployment, latest_stage: { name: 'deploy', status: 'success' } });
    expect(await readStudioGitBuild(token, attempt, id)).toMatchObject({ outcome: 'verified', deployment: { state: 'succeeded' } });
  });
  it('keeps a missing deployment unresolved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await readStudioGitBuild(token, attempt, id)).toEqual({ outcome: 'unavailable' });
  });
  it('bounds a provider response and leaves mutation ambiguity locked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1048577))));
    expect(await startStudioGitBuild(token, attempt)).toEqual({ outcome: 'ambiguous' });
  });
});
