import { describe, expect, it } from "vitest";
import { canOrganizationRole, legacyRoleToOrganizationRole } from "../lib/organization-access";

describe("organization access", () => {
  it("maps legacy roles without increasing their authority", () => {
    expect(legacyRoleToOrganizationRole("owner")).toBe("owner");
    expect(legacyRoleToOrganizationRole("employee")).toBe("operator");
    expect(legacyRoleToOrganizationRole("customer")).toBe("client");
  });

  it("allows owners to administer the organization", () => {
    expect(canOrganizationRole("owner", "organization.manage")).toBe(true);
    expect(canOrganizationRole("owner", "audit.read")).toBe(true);
  });

  it("keeps client users out of agency administration", () => {
    expect(canOrganizationRole("client", "reports.read")).toBe(true);
    expect(canOrganizationRole("client", "organization.manage")).toBe(false);
    expect(canOrganizationRole("client", "clients.manage")).toBe(false);
  });

  it("keeps viewers read-only", () => {
    expect(canOrganizationRole("viewer", "clients.read")).toBe(true);
    expect(canOrganizationRole("viewer", "reports.export")).toBe(false);
    expect(canOrganizationRole("viewer", "integrations.manage")).toBe(false);
  });
});
