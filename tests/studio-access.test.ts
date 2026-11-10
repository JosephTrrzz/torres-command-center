import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuth, type AuthContext, type FunctionEnv } from '../functions/_shared/auth';
import { studioAccess } from '../functions/_shared/studio-access';

vi.mock('../functions/_shared/auth', async importOriginal => ({
  ...await importOriginal<typeof import('../functions/_shared/auth')>(),
  requireAuth: vi.fn(),
}));

const assigned = '11111111-1111-4111-8111-111111111111';
const requested = '22222222-2222-4222-8222-222222222222';
const agency = '33333333-3333-4333-8333-333333333333';
const clientOrganization = '44444444-4444-4444-8444-444444444444';
const env: FunctionEnv = {};
const auth = vi.mocked(requireAuth);

function agencyUser(role: 'owner' | 'admin' | 'operator' | 'member' | 'viewer' = 'admin'): AuthContext {
  return {
    userId: 'test-user', email: null, fullName: null,
    role: role === 'owner' ? 'owner' : 'employee', clientId: assigned,
    organizationId: agency, organizationRole: role, permissions: [],
    memberships: [{ organizationId: agency, role, kind: 'agency', parentOrganizationId: null, legacyClientId: null }],
    authorizationSource: 'organization',
  };
}

function clientUser(): AuthContext {
  return {
    ...agencyUser(), role: 'customer', organizationRole: 'client', organizationId: clientOrganization,
    memberships: [{ organizationId: clientOrganization, role: 'client', kind: 'client', parentOrganizationId: agency, legacyClientId: assigned }],
  };
}

function request(client = requested) {
  return new Request('https://admin.example/api/website/publish?client=' + client);
}

beforeEach(() => auth.mockReset());

describe('Studio client selection authorization', () => {
  it.each(['owner', 'admin'] as const)('allows an agency %s to request a client only after scoped authorization', async role => {
    // No profile assignment is needed for an authorized agency administrator.
    const context = { ...agencyUser(role), clientId: null };
    auth.mockResolvedValue({ context });
    const req = request();

    expect(await studioAccess(req, env)).toEqual({ context, staff: true, clientId: requested });
    expect(auth).toHaveBeenCalledTimes(2);
    expect(auth).toHaveBeenNthCalledWith(1, req, env);
    expect(auth).toHaveBeenNthCalledWith(2, req, env, { clientId: requested });
  });

  it('propagates the second, client-scoped denial for an agency admin', async () => {
    const denial = { response: new Response('Outside membership scope', { status: 403 }) };
    auth.mockResolvedValueOnce({ context: agencyUser() }).mockResolvedValueOnce(denial);
    const req = request();

    expect(await studioAccess(req, env)).toBe(denial);
    expect(auth).toHaveBeenCalledTimes(2);
    expect(auth).toHaveBeenLastCalledWith(req, env, { clientId: requested });
  });

  it('rejects a client requesting another client before scoped authorization', async () => {
    auth.mockResolvedValue({ context: clientUser() });
    expect(await studioAccess(request(), env)).toMatchObject({ response: { status: 403 } });
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('does not let a website-only owner escalate through agency privileges', async () => {
    auth.mockResolvedValue({ context: { ...agencyUser('owner'), websiteOnly: true } });
    expect(await studioAccess(request(), env)).toMatchObject({ response: { status: 403 } });
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('allows a client to access its assigned website after scoped authorization', async () => {
    const context = clientUser();
    auth.mockResolvedValue({ context });
    const req = request(assigned);
    expect(await studioAccess(req, env)).toEqual({ context, staff: false, clientId: assigned });
    expect(auth).toHaveBeenCalledTimes(2);
    expect(auth).toHaveBeenLastCalledWith(req, env, { clientId: assigned });
  });

  it.each(['operator', 'member', 'viewer'] as const)('does not grant broad website access to an agency %s', async role => {
    auth.mockResolvedValue({ context: agencyUser(role) });
    expect(await studioAccess(request(), env)).toMatchObject({ response: { status: 403 } });
  });

  it('does not grant broad website access to a legacy employee', async () => {
    auth.mockResolvedValue({ context: {
      ...agencyUser(), role: 'employee', organizationRole: null,
      organizationId: null, memberships: [], authorizationSource: 'legacy',
    } });
    expect(await studioAccess(request(), env)).toMatchObject({ response: { status: 403 } });
  });

  it('returns an initial authentication denial without attempting client authorization', async () => {
    const denial = { response: new Response(null, { status: 401 }) };
    auth.mockResolvedValueOnce(denial);
    expect(await studioAccess(request(), env)).toBe(denial);
    expect(auth).toHaveBeenCalledTimes(1);
  });
});
