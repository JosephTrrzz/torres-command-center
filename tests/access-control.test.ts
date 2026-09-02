import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  defaultRouteForRole,
  isSafeReturnTo,
} from "../lib/access-control";
import { canAccessClient, canSwitchOrganization } from "../functions/_shared/auth";
import { buildNotificationInsert } from "../functions/_shared/notifications";

describe("role access control", () => {
  it("keeps customers inside their portal", () => {
    expect(canAccessPath("customer", "/portal/")).toBe(true);
    expect(canAccessPath("customer", "/today/")).toBe(true);
    expect(canAccessPath("customer", "/onboarding/")).toBe(true);
    expect(canAccessPath("customer", "/projects/")).toBe(true);
    expect(canAccessPath("customer", "/operations/")).toBe(true);
    expect(canAccessPath("customer", "/inbox/")).toBe(true);
    expect(canAccessPath("customer", "/reports/")).toBe(true);
    expect(canAccessPath("customer", "/crm/")).toBe(false);
    expect(canAccessPath("customer", "/portal/account/")).toBe(true);
    expect(canAccessPath("customer", "/portal-impersonation/")).toBe(false);
    expect(canAccessPath("customer", "/clients/")).toBe(false);
    expect(canAccessPath("customer", "/settings/")).toBe(false);
  });

  it("allows employees to operate client workflows but not owner settings", () => {
    expect(canAccessPath("employee", "/today/")).toBe(true);
    expect(canAccessPath("employee", "/clients/detail/")).toBe(true);
    expect(canAccessPath("employee", "/integrations/")).toBe(true);
    expect(canAccessPath("employee", "/projects/")).toBe(true);
    expect(canAccessPath("employee", "/operations/")).toBe(true);
    expect(canAccessPath("employee", "/inbox/")).toBe(true);
    expect(canAccessPath("employee", "/crm/")).toBe(true);
    expect(canAccessPath("employee", "/settings/")).toBe(false);
  });

  it("uses safe role landing pages", () => {
    expect(defaultRouteForRole("owner")).toBe("/");
    expect(defaultRouteForRole("customer")).toBe("/today/");
  });

  it("rejects external and protocol-relative return paths", () => {
    expect(isSafeReturnTo("/clients/")).toBe(true);
    expect(isSafeReturnTo("https://example.com")).toBe(false);
    expect(isSafeReturnTo("//example.com")).toBe(false);
  });

  it("does not treat similar route names as protected routes", () => {
    expect(canAccessPath("employee", "/clients-archive/")).toBe(false);
    expect(canAccessPath("customer", "/login-legacy/")).toBe(false);
  });

  it("enforces client isolation at the Function boundary", () => {
    expect(canAccessClient({ role: "owner", clientId: null }, "client-b")).toBe(true);
    expect(canAccessClient({ role: "employee", clientId: null }, "client-b")).toBe(true);
    expect(canAccessClient({ role: "customer", clientId: "client-a" }, "client-a")).toBe(true);
    expect(canAccessClient({ role: "customer", clientId: "client-a" }, "client-b")).toBe(false);
    expect(canAccessClient({ role: "customer", clientId: null }, "client-a")).toBe(false);
  });

  it("uses organization memberships as the authoritative client boundary", () => {
    const agencyMembership = [{ organizationId: "agency-1", role: "operator" as const, kind: "agency" as const, parentOrganizationId: null, legacyClientId: null }];
    const clientMembership = [{ organizationId: "client-org-1", role: "client" as const, kind: "client" as const, parentOrganizationId: "agency-1", legacyClientId: "client-1" }];
    const target = { id: "client-org-1", parentOrganizationId: "agency-1", legacyClientId: "client-1" };
    const otherTarget = { id: "client-org-2", parentOrganizationId: "agency-1", legacyClientId: "client-2" };

    expect(canAccessClient({ role: "employee", clientId: null, memberships: agencyMembership }, "client-1", target)).toBe(true);
    expect(canAccessClient({ role: "customer", clientId: "client-1", memberships: clientMembership }, "client-1", target)).toBe(true);
    expect(canAccessClient({ role: "customer", clientId: null, memberships: clientMembership }, "client-2", otherTarget)).toBe(false);
    expect(canAccessClient({ role: "customer", clientId: "client-2", memberships: clientMembership }, "client-2", otherTarget)).toBe(false);
    expect(canAccessClient({ role: "employee", clientId: null, memberships: agencyMembership }, "client-1", null)).toBe(false);
  });

  it("switches only to an organization with an active resolved membership", () => {
    const memberships = [
      { organizationId: "agency-1", role: "owner" as const, kind: "agency" as const, parentOrganizationId: null, legacyClientId: null },
      { organizationId: "client-org-1", role: "client" as const, kind: "client" as const, parentOrganizationId: "agency-1", legacyClientId: "client-1" },
    ];
    expect(canSwitchOrganization(memberships, "agency-1")).toBe(true);
    expect(canSwitchOrganization(memberships, "client-org-1")).toBe(true);
    expect(canSwitchOrganization(memberships, "client-org-2")).toBe(false);
  });

  it("builds user-scoped notifications without undefined database fields", () => {
    expect(buildNotificationInsert({
      userId: "user-1",
      clientId: "client-1",
      type: "action",
      title: "  Client activation ready  ",
      body: "  A client can activate their portal.  ",
    })).toEqual({
      user_id: "user-1",
      client_id: "client-1",
      type: "action",
      title: "Client activation ready",
      body: "A client can activate their portal.",
      href: null,
    });
  });
});
