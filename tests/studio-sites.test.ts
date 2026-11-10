import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuth, type AuthContext, type FunctionEnv } from '../functions/_shared/auth';
import { onRequestGet } from '../functions/api/website/sites';

// Keep the real studioAdministrator/studioAccess boundary: only identity/storage
// I/O is mocked, so every included client must pass the actual scoped access path.
vi.mock('../functions/_shared/auth', async importOriginal => ({
  ...await importOriginal<typeof import('../functions/_shared/auth')>(),
  requireAuth: vi.fn(),
}));
const auth = vi.mocked(requireAuth);
const env: FunctionEnv = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key' };
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const admin: AuthContext = {
  userId: 'test-user', email: null, fullName: null, role: 'employee', clientId: null,
  organizationId: 'agency', organizationRole: 'admin', permissions: ['clients.read'],
  memberships: [{ organizationId: 'agency', role: 'admin', kind: 'agency', parentOrganizationId: null, legacyClientId: null }],
  authorizationSource: 'organization',
};
const request = () => new Request('https://admin.example/api/website/sites?client=untrusted-initial-selection', {
  headers: { Authorization: 'Bearer test-user-token' },
});
const call = () => onRequestGet({ request: request(), env });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.mockReset(); auth.mockResolvedValue({ context: admin });
  fetcher = vi.fn().mockResolvedValue(json([])); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('managed website directory authorization', () => {
  it.each(['operator', 'member', 'viewer', 'client'] as const)('returns no directory and never fetches for %s', async organizationRole => {
    auth.mockResolvedValue({ context: { ...admin, organizationRole } });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ administrator: false, sites: [] });
    expect(fetcher).not.toHaveBeenCalled(); expect(auth).toHaveBeenCalledTimes(1);
  });
  it.each(['employee', 'customer'] as const)('does not fetch for legacy %s', async role => {
    auth.mockResolvedValue({ context: { ...admin, role, organizationRole: null, memberships: [], authorizationSource: 'legacy' } });
    expect(await (await call()).json()).toEqual({ administrator: false, sites: [] });
    expect(fetcher).not.toHaveBeenCalled(); expect(auth).toHaveBeenCalledTimes(1);
  });
  it('does not fetch for a website-only owner', async () => {
    auth.mockResolvedValue({ context: { ...admin, role: 'owner', organizationRole: 'owner', websiteOnly: true } });
    expect(await (await call()).json()).toEqual({ administrator: false, sites: [] });
    expect(fetcher).not.toHaveBeenCalled(); expect(auth).toHaveBeenCalledTimes(1);
  });
  it('returns initial authentication failure before directory access', async () => {
    const response = json({ error: 'Sign in' }, 401); auth.mockResolvedValue({ response });
    expect(await call()).toBe(response); expect(fetcher).not.toHaveBeenCalled();
  });
  it('omits independently denied 403/404 clients and sorts only authorized names', async () => {
    const rows = [
      { id: ids[0], name: 'Zulu' }, { id: ids[1], name: 'Private denied client' },
      { id: ids[2], name: 'Private missing client' }, { id: ids[3], name: 'Alpha' },
    ];
    fetcher.mockResolvedValue(json(rows));
    auth.mockImplementation(async (_req, _env, scope) => {
      if (scope?.clientId === ids[1]) return { response: json({ error: 'Denied' }, 403) };
      if (scope?.clientId === ids[2]) return { response: json({ error: 'Missing' }, 404) };
      return { context: admin };
    });
    const response = await call();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ administrator: true, sites: [{ clientId: ids[3], name: 'Alpha' }, { clientId: ids[0], name: 'Zulu' }] });
    const scoped = auth.mock.calls.filter(([, , scope]) => scope?.clientId);
    expect(scoped.map(([, , scope]) => scope!.clientId)).toEqual(ids);
    for (const [req, receivedEnv, scope] of scoped) {
      expect(new URL(req.url).searchParams.get('client')).toBe(scope!.clientId);
      expect(req.headers.get('authorization')).toBe('Bearer test-user-token'); expect(receivedEnv).toBe(env);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.pathname).toBe('/rest/v1/clients'); expect(url.searchParams.get('select')).toBe('id,name');
    expect(url.searchParams.get('order')).toBe('id'); expect(url.searchParams.get('limit')).toBe('100');
  });
  it.each([401, 429, 500, 503])('fails closed on scoped %i after collecting an authorized client', async status => {
    fetcher.mockResolvedValue(json(ids.slice(0, 3).map((id, i) => ({ id, name: 'Sensitive client ' + i }))));
    const failure = json({ error: 'Scoped authorization unavailable' }, status);
    auth.mockImplementation(async (_req, _env, scope) => scope?.clientId === ids[1] ? { response: failure } : { context: admin });
    const response = await call(); expect(response).toBe(failure); expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Scoped authorization unavailable' });
    expect(auth.mock.calls.filter(([, , scope]) => scope?.clientId).map(([, , scope]) => scope!.clientId)).toEqual(ids.slice(0, 2));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not include scoped success when it resolves to non-staff', async () => {
    fetcher.mockResolvedValue(json([{ id: ids[0], name: 'Private client' }]));
    auth.mockImplementation(async (_req, _env, scope) => ({ context: scope ? {
      ...admin, role: 'customer', organizationRole: 'client', clientId: ids[0],
      memberships: [{ organizationId: 'client-org', role: 'client', kind: 'client', parentOrganizationId: 'agency', legacyClientId: ids[0] }],
    } : admin }));
    expect(await (await call()).json()).toEqual({ administrator: true, sites: [] });
  });
  it('returns a directory error without attempting scope checks when storage fails', async () => {
    fetcher.mockResolvedValue(json({ error: 'Storage detail' }, 500));
    const response = await call(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Managed websites could not be loaded.' });
    expect(auth).toHaveBeenCalledTimes(1);
  });
  it('does not return a partial directory if later pagination fails', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, name: `Client ${i}` }));
    fetcher.mockResolvedValueOnce(json(rows)).mockResolvedValueOnce(json({ error: 'Storage error' }, 503));
    const response = await call(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Managed websites could not be loaded.' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('offset')).toBe('100');
    expect(auth.mock.calls.filter(([, , scope]) => scope?.clientId)).toHaveLength(100);
  });
});
