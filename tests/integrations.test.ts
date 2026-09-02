import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEGRATION_PROVIDERS, integrationScopeLabel, integrationStatusLabel } from "../lib/integrations";

const api = readFileSync(join(process.cwd(), "functions", "api", "integrations", "index.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase", "integration_control.sql"), "utf8");

describe("integration control foundation", () => {
  it("defines the initial normalized provider registry", () => {
    expect(INTEGRATION_PROVIDERS).toEqual(["google", "resend", "website_intake", "supabase", "cloudflare"]);
    expect(integrationStatusLabel("action_required")).toBe("Action required");
    expect(integrationScopeLabel("organization")).toBe("Agency-wide");
  });

  it("keeps connection state behind organization permissions", () => {
    expect(api).toContain('permission: "integrations.read"');
    expect(api).toContain('permission: "integrations.manage"');
    expect(api).toContain("staffOnly: true");
    expect(api).toContain("canManage");
  });

  it("keeps credentials out of the normalized registry", () => {
    expect(migration).toContain("Secret-free");
    expect(migration).not.toMatch(/\b(access_token|refresh_token|api_key|webhook_secret)\s+text\b/);
    expect(migration).toContain("integration_sync_runs");
  });

  it("requires explicit confirmation before disconnecting Google", () => {
    expect(api).toContain('body.confirmation !== "DISCONNECT"');
    expect(api).toContain("oauth2.googleapis.com/revoke");
    expect(api).toContain("google_connections?client_id=eq.");
  });
});

