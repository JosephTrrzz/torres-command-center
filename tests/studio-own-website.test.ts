import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest as canvasDrafts } from "../functions/api/website/canvas-drafts";
import { studioAccess } from "../functions/_shared/studio-access";
import { requireAuth, type AuthContext } from "../functions/_shared/auth";
vi.mock("../functions/_shared/auth", async original => ({ ...await original<typeof import("../functions/_shared/auth")>(), requireAuth: vi.fn() }));
const own = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function identity(role: "owner" | "admin" | "client", assigned: string | null = own, clientMembership = false) {
  const context = { role: role === "client" ? "customer" : "owner", organizationRole: role, clientId: assigned, organizationId: "active", memberships: [{ organizationId: "active", kind: clientMembership ? "client" : "agency", legacyClientId: clientMembership ? own : null, role }] } as AuthContext;
  vi.mocked(requireAuth).mockResolvedValue({ context });
}
function access(client?: string) { return studioAccess(new Request("https://app.test/api/website/canvas-drafts" + (client ? "?client=" + client : "")), {}); }
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe("own website only, including administrators", () => {
  it.each(["owner", "admin", "client"] as const)("allows %s's assigned website", async role => {
    identity(role, own, role === "client");
    expect(await access()).toMatchObject({ clientId: own });
    expect(await access(own)).toMatchObject({ clientId: own });
  });
  it.each(["owner", "admin", "client"] as const)("rejects %s changing the client URL before scoped access", async role => {
    identity(role, own, role === "client");
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
    expect(await access()).toMatchObject({ clientId: own });
    const result = await access(other);
    expect("response" in result && result.response.status).toBe(403);
  });
  it("still enforces the authenticated scoped check", async () => {
    identity("owner");
    vi.mocked(requireAuth).mockResolvedValueOnce({ context: { role: "owner", clientId: own, memberships: [] } as unknown as AuthContext }).mockResolvedValueOnce({ response: new Response(null, { status: 403 }) });
    const result = await access();
    expect("response" in result && result.response.status).toBe(403);
  });
});

it.each(["owner", "admin", "client"] as const)("blocks foreign draft reads and writes for %s before storage", async role => {
  identity(role, own, role === "client");
  const storage = vi.fn(); vi.stubGlobal("fetch", storage);
  for (const method of ["GET", "POST"]) {
    const response = await canvasDrafts({ env: {}, request: new Request("https://app.test/api/website/canvas-drafts?client=" + other, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 0, draft: {} }) } : {}) }) });
    expect(response.status).toBe(403);
  }
  expect(storage).not.toHaveBeenCalled();
});
