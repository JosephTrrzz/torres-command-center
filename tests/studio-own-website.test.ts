import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest as canvasDrafts } from "../functions/api/website/canvas-drafts";
import { onRequest as publish } from "../functions/api/website/publish";
import { studioAccess } from "../functions/_shared/studio-access";
import { requireAuth, type AuthContext } from "../functions/_shared/auth";
vi.mock("../functions/_shared/auth", async original => ({ ...await original<typeof import("../functions/_shared/auth")>(), requireAuth: vi.fn() }));
const own = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function identity(role: "owner" | "admin" | "client", assigned: string | null = own, clientMembership = false) {
  const context = { role: role === "client" ? "customer" : "owner", organizationRole: role, clientId: assigned, organizationId: "active", memberships: [{ organizationId: "active", kind: clientMembership ? "client" : "agency", legacyClientId: clientMembership ? own : null, role }] } as AuthContext;
  vi.mocked(requireAuth).mockResolvedValue({ context });
  return context;
}
function denyForeignScope(role: "owner" | "admin" | "client") {
  const context = identity(role, own, role === "client");
  vi.mocked(requireAuth).mockImplementation(async (_request, _env, options) =>
    options?.clientId === other
      ? { response: new Response(null, { status: 403 }) }
      : { context });
}
function access(client?: string) { return studioAccess(new Request("https://app.test/api/website/canvas-drafts" + (client ? "?client=" + client : "")), {}); }
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("assigned client websites and scoped agency administration", () => {
  it.each(["owner", "admin"] as const)("allows agency %s to select a managed website after scoped authorization", async role => {
    identity(role);
    expect(await access(other)).toMatchObject({ clientId: other, staff: true });
    expect(requireAuth).toHaveBeenCalledTimes(2);
    expect(requireAuth).toHaveBeenLastCalledWith(expect.any(Request), {}, { clientId: other });
  });
  it.each(["owner", "admin", "client"] as const)("allows %s's assigned website", async role => {
    identity(role, own, role === "client");
    expect(await access()).toMatchObject({ clientId: own });
    expect(await access(own)).toMatchObject({ clientId: own });
  });
  it.each(["owner", "admin"] as const)("rejects agency %s when the second scoped authorization denies the requested website", async role => {
    denyForeignScope(role);
    const result = await access(other);
    expect("response" in result && result.response.status).toBe(403);
    expect(requireAuth).toHaveBeenCalledTimes(2);
    expect(requireAuth).toHaveBeenLastCalledWith(expect.any(Request), {}, { clientId: other });
  });
  it("rejects clients changing the client URL before scoped access", async () => {
    identity("client", own, true);
    const result = await access(other);
    expect("response" in result && result.response.status).toBe(403);
    expect(requireAuth).toHaveBeenCalledTimes(1);
  });
  it.each(["owner", "admin", "client"] as const)("does not give unassigned %s a default website", async role => {
    identity(role, null);
    const result = await access();
    expect("response" in result && result.response.status).toBe(403);
  });
  it("uses a client organization's assignment for its admin instead of a stale profile", async () => {
    identity("admin", other, true);
    expect(await access()).toMatchObject({ clientId: own, staff: true });
    expect(requireAuth).toHaveBeenLastCalledWith(expect.any(Request), {}, { clientId: own });
    vi.mocked(requireAuth).mockClear();
    const result = await access(other);
    expect("response" in result && result.response.status).toBe(403);
    expect(requireAuth).toHaveBeenCalledTimes(1);
  });
  it("still enforces the authenticated scoped check", async () => {
    identity("owner");
    vi.mocked(requireAuth).mockResolvedValueOnce({ context: { role: "owner", clientId: own, memberships: [] } as unknown as AuthContext }).mockResolvedValueOnce({ response: new Response(null, { status: 403 }) });
    const result = await access();
    expect("response" in result && result.response.status).toBe(403);
  });
});

it.each(["owner", "admin", "client"] as const)("blocks foreign draft reads and writes for %s before storage", async role => {
  denyForeignScope(role);
  const storage = vi.fn(); vi.stubGlobal("fetch", storage);
  for (const method of ["GET", "POST"]) {
    const response = await canvasDrafts({ env: {}, request: new Request("https://app.test/api/website/canvas-drafts?client=" + other, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 0, draft: {} }) } : {}) }) });
    expect(response.status).toBe(403);
  }
  expect(storage).not.toHaveBeenCalled();
  expect(requireAuth).toHaveBeenCalledTimes(role === "client" ? 2 : 4);
  if (role !== "client") expect(requireAuth).toHaveBeenLastCalledWith(expect.any(Request), {}, { clientId: other });
});

it.each(["owner", "admin", "client"] as const)("blocks foreign publishing for %s before storage or provider calls", async role => {
 denyForeignScope(role);const storage=vi.fn();vi.stubGlobal("fetch",storage);
 for(const method of ["GET","POST"]){
  const response=await publish({env:{},request:new Request("https://app.test/api/website/publish?client="+other,{method,...(method==="POST"?{headers:{"Content-Type":"application/json"},body:"{}"}:{})})});
  expect(response.status).toBe(403);
 }
 expect(storage).not.toHaveBeenCalled();
 expect(requireAuth).toHaveBeenCalledTimes(role === "client" ? 2 : 4);
 if (role !== "client") expect(requireAuth).toHaveBeenLastCalledWith(expect.any(Request), {}, { clientId: other });
});
