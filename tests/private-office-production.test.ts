import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(join(process.cwd(), "components", "shell.tsx"), "utf8");
const portal = readFileSync(join(process.cwd(), "app", "portal", "page.tsx"), "utf8");
const login = readFileSync(join(process.cwd(), "app", "login", "page.tsx"), "utf8");
const component = readFileSync(join(process.cwd(), "components", "private-office.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "app", "private-office-production.css"), "utf8");
const design = readFileSync(join(process.cwd(), "DESIGN.md"), "utf8");

describe("Private Office production integration", () => {
  it("keeps the role-aware shell while presenting client language", () => {
    expect(shell).toContain('data-shell-variant={effectiveRole === "customer" ? "client" : "internal"}');
    expect(shell).toContain('Today: "Home"');
    expect(shell).toContain('"My account": "Account"');
    expect(shell).toContain("Private Office");
  });

  it("builds the client arrival from live portal values", () => {
    expect(portal).toContain("PrivateOfficePortfolioPanel");
    expect(portal).toContain("businessName={client.name}");
    expect(portal).toContain("clientSince={account.created_at}");
    expect(portal).toContain("people[0]?.name || account.portal_email");
    expect(component).not.toContain("$12,400");
  });

  it("uses one existing authentication flow and responsive presentation", () => {
    expect(login).toContain("login-private-office-layout");
    expect(login).toContain("createAuthSession(email, password)");
    expect(styles).toContain("@media(max-width:680px)");
    expect(styles).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("records Private Office as a permanent role-aware pattern", () => {
    expect(design).toContain("Private Office production mode");
    expect(design).toContain("same routes, Supabase records, APIs, permission checks, and workflows");
  });

  it("uses the official Torres artwork for the gold security pattern and emblem", () => {
    expect(existsSync(join(process.cwd(), "public", "brand", "private-office-pattern.png"))).toBe(true);
    expect(existsSync(join(process.cwd(), "public", "brand", "private-office-pattern-spaced.png"))).toBe(true);
    expect(styles).toContain('url("/brand/private-office-pattern-spaced.png")');
    expect(styles).toContain('url("/brand/private-office-pattern.png")');
    expect(styles).toContain(".app-shell[data-shell-variant=client]::before");
    expect(styles).toContain(".private-office-diamond");
    expect(styles).toContain("mask:");
    expect(design).toContain("security-print pattern");
  });
});
