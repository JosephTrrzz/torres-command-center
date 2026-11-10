import { afterEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_CLOUDFLARE_TARGET as target, verifyStudioCloudflareCredential } from '../functions/_shared/studio-cloudflare';
const token = 'test-token-not-a-real-secret';
const project = { name: target.project, domains: [target.hostname], production_branch: 'main',
  env_vars: { SECRET: { value: 'must-not-escape' } },
  canonical_deployment: { id: 'deployment-1', environment: 'production', deployment_trigger: { metadata: { commit_hash: 'a'.repeat(40) } } } };
afterEach(() => vi.unstubAllGlobals());
describe('server-only Cloudflare connection verification', () => {
  it('does not contact Cloudflare without a configured credential', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await verifyStudioCloudflareCredential(undefined)).toEqual({ credential: 'missing' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('contacts only the enrolled project and returns no project settings or secrets', async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ success: true, result: project })); vi.stubGlobal('fetch', fetcher);
    const result = await verifyStudioCloudflareCredential(token);
    expect(result).toEqual({ credential: 'verified', sourceCommit: 'a'.repeat(40), deploymentId: 'deployment-1' });
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${target.account}/pages/projects/${target.project}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer ' + token } });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });
  it.each([401, 403, 429, 500])('does not treat HTTP %i as connected', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider detail', { status })));
    expect((await verifyStudioCloudflareCredential(token)).credential).toBe(status < 429 ? 'rejected' : 'unavailable');
  });
  it.each([{ ...project, name: 'another-client' }, { ...project, domains: ['other.example'] }, { ...project, production_branch: 'preview' }])('rejects target changes', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, result: value })));
    expect(await verifyStudioCloudflareCredential(token)).toEqual({ credential: 'target_mismatch' });
  });
  it('does not leak provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error(token); }));
    expect(await verifyStudioCloudflareCredential(token)).toEqual({ credential: 'unavailable', reason: 'connection_error' });
  });
});
