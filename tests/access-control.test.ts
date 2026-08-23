import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  defaultRouteForRole,
  isSafeReturnTo,
} from "../lib/access-control";

describe("role access control", () => {
  it("keeps customers inside their portal", () => {
    expect(canAccessPath("customer", "/portal/")).toBe(true);
    expect(canAccessPath("customer", "/portal/account/")).toBe(true);
    expect(canAccessPath("customer", "/portal-impersonation/")).toBe(false);
    expect(canAccessPath("customer", "/clients/")).toBe(false);
    expect(canAccessPath("customer", "/settings/")).toBe(false);
  });

  it("allows employees to operate client workflows but not owner settings", () => {
    expect(canAccessPath("employee", "/clients/detail/")).toBe(true);
    expect(canAccessPath("employee", "/integrations/")).toBe(true);
    expect(canAccessPath("employee", "/settings/")).toBe(false);
  });

  it("uses safe role landing pages", () => {
    expect(defaultRouteForRole("owner")).toBe("/");
    expect(defaultRouteForRole("customer")).toBe("/portal/");
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
});
