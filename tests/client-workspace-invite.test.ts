import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(join(process.cwd(), "components", "shell.tsx"), "utf8");
const endpoint = readFileSync(join(process.cwd(), "functions", "api", "client", "team-invite.ts"), "utf8");
const styles = readFileSync(join(process.cwd(), "app", "ui-enhancements.css"), "utf8");

describe("client workspace teammate access", () => {
  it("offers the invitation only inside the client shell", () => {
    expect(shell).toContain('effectiveRole === "customer" && session.organization?.kind === "client"');
    expect(shell).toContain('fetch("/api/client/team-invite"');
    expect(shell).toContain("same client-only view");
  });

  it("binds invitations to the selected active client membership", () => {
    expect(endpoint).toContain('membership.organizationId === auth.context.organizationId');
    expect(endpoint).toContain('membership.kind === "client"');
    expect(endpoint).toContain('membership.role === "client"');
    expect(endpoint).toContain('role: "client"');
    expect(endpoint).not.toContain("customer_accounts");
  });

  it("keeps onboarding controls comfortably sized", () => {
    expect(styles).toContain(".onboarding-form-grid .form-field input");
    expect(styles).toContain("min-height:48px");
    expect(styles).toContain("min-height:108px");
  });
});
