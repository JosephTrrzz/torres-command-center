import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "../functions/_shared/auth";

const env = { SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "test-public", SUPABASE_SERVICE_ROLE_KEY: "test-server" };
const request = () => new Request("https://example.invalid/api/onboarding", { headers: { Authorization: "Bearer test-session" } });

function mockLookup(response: Response) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: "user-1", email: "member@example.invalid" }))
    .mockResolvedValueOnce(Response.json([{ role: "employee", active: true, default_organization_id: "agency-1" }]))
    .mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("organization authorization lookup failures", () => {
  it.each([401, 403, 500, 503])("does not grant legacy permissions after a %s lookup failure", async (status) => {
    const fetchMock = mockLookup(Response.json({ error: "unavailable" }, { status }));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(["not-json", '{"error":"unexpected shape"}'])("rejects malformed successful responses: %s", async (body) => {
    mockLookup(new Response(body));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(503);
  });

  it("preserves compatibility for a successfully verified empty membership list", async () => {
    mockLookup(Response.json([]));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("context" in result && result.context.authorizationSource).toBe("legacy");
  });

  it("uses membership permissions instead of a broader legacy employee role", async () => {
    mockLookup(Response.json([{ organization_id: "agency-1", role: "viewer", status: "active", organizations: { id: "agency-1", kind: "agency", status: "active" } }]));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(403);
  });
});

describe("membership rows and target-specific authority", () => {
  const member = (id: string, role: string, kind = "agency", status = "active") => ({ organization_id: id, role, status, organizations: { id, kind, status: "active" } });
  it.each([[{}], [null], ["invalid"], [member("agency-1", "unknown")], [{ ...member("agency-1", "owner"), organizations: { id: "other", kind: "agency", status: "active" } }]])("rejects malformed rows without falling back: %j", async (row) => {
    mockLookup(Response.json([row]));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(503);
  });
  it.each(["revoked", "suspended", "invited"])("does not restore legacy authority for %s membership", async (status) => {
    mockLookup(Response.json([member("agency-1", "owner", "agency", status)]));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(403);
  });
  it("does not restore legacy authority for a paused organization", async () => {
    const row = member("agency-1", "owner"); row.organizations.status = "paused";
    mockLookup(Response.json([row]));
    const result = await requireAuth(request(), env, { permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(403);
  });
  function targetLookup(rows: unknown[]) {
    return mockLookup(Response.json(rows))
      .mockResolvedValueOnce(Response.json([{ id: "client-2", organization_id: "client-org-2" }]))
      .mockResolvedValueOnce(Response.json([{ id: "client-org-2", parent_organization_id: "agency-2", status: "active" }]));
  }
  it("denies manage in agency B despite selected owner authority in agency A", async () => {
    targetLookup([member("agency-1", "owner"), member("agency-2", "viewer")]);
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(403);
  });
  it("permits read in B and returns B's viewer context", async () => {
    targetLookup([member("agency-1", "owner"), member("agency-2", "viewer")]);
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "reports.read" });
    expect("context" in result && result.context.organizationId).toBe("agency-2");
    expect("context" in result && result.context.permissions.includes("clients.manage")).toBe(false);
  });
  it("permits manage from applicable owner B even if selected workspace A is viewer", async () => {
    targetLookup([member("agency-1", "viewer"), member("agency-2", "owner")]);
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "clients.manage", staffOnly: true });
    expect("context" in result && result.context.organizationRole).toBe("owner");
  });
  it("does not borrow staff status for a direct client membership", async () => {
    targetLookup([member("agency-1", "owner"), member("client-org-2", "client", "client")]);
    const result = await requireAuth(request(), env, { clientId: "client-2", staffOnly: true });
    expect("response" in result && result.response.status).toBe(403);
  });
  it("permits customer reporting through a direct client membership", async () => {
    targetLookup([member("agency-1", "viewer"), member("client-org-2", "client", "client")]);
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "reports.read" });
    expect("context" in result && result.context.organizationRole).toBe("client");
  });
  it("denies clients outside every membership", async () => {
    targetLookup([member("agency-1", "owner")]);
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "reports.read" });
    expect("response" in result && result.response.status).toBe(403);
  });
});

describe("client lookup failures do not widen compatibility access", () => {
  it("rejects a failed client lookup for a legacy staff account", async () => {
    mockLookup(Response.json([])).mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(503);
  });
  it("rejects a failed target organization lookup", async () => {
    mockLookup(Response.json([]))
      .mockResolvedValueOnce(Response.json([{ id: "client-2", organization_id: "client-org-2" }]))
      .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    const result = await requireAuth(request(), env, { clientId: "client-2", permission: "clients.manage" });
    expect("response" in result && result.response.status).toBe(503);
  });
  it("does not exclude revoked membership history from verification", async () => {
    const fetchMock = mockLookup(Response.json([]));
    await requireAuth(request(), env);
    expect(fetchMock.mock.calls[2][0]).not.toContain("status=eq.active");
  });
});

describe('website-only server authorization',()=>{
 function websiteAccount(){
  vi.stubGlobal('fetch',vi.fn()
   .mockResolvedValueOnce(Response.json({id:'website-user'}))
   .mockResolvedValueOnce(Response.json([{role:'customer',active:true,website_only:true,client_id:'client-a'}]))
   .mockResolvedValueOnce(Response.json([])));
 }
 it.each(['/api/crm','/api/operations','/api/reports','/api/communications','/api/website/editor','/api/profile','/api/workspace/switch','/api/website-context'])('denies %s even with a verified token',async path=>{
  websiteAccount();const result=await requireAuth(new Request('https://local.test'+path,{headers:{Authorization:'Bearer test'}}),env);
  expect('response' in result && result.response.status).toBe(403);
 });
 it('allows the website workspace through the same verifier',async()=>{
  websiteAccount();const result=await requireAuth(new Request('https://local.test/api/website/workspace',{headers:{Authorization:'Bearer test'}}),env);
  expect('context' in result && result.context.websiteOnly).toBe(true);
 });
});
