import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEGRATION_PROVIDERS, integrationAutomationState, integrationScopeLabel, integrationStatusLabel } from "../lib/integrations";

const api = readFileSync(join(process.cwd(), "functions", "api", "integrations", "index.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase", "integration_control.sql"), "utf8");
const automationMigration = readFileSync(join(process.cwd(), "supabase", "integration_automation.sql"), "utf8");
const scheduler = readFileSync(join(process.cwd(), "functions", "api", "integrations", "scheduled.ts"), "utf8");

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

  it("opens an alert after two failures and resolves it after recovery", () => {
    expect(integrationAutomationState("degraded", 0, false)).toMatchObject({ consecutiveFailures: 1, alertOpen: false, alertOpened: false });
    expect(integrationAutomationState("action_required", 1, false)).toMatchObject({ consecutiveFailures: 2, alertOpen: true, alertOpened: true });
    expect(integrationAutomationState("connected", 4, true)).toMatchObject({ consecutiveFailures: 0, alertOpen: false, alertResolved: true });
  });

  it("keeps the hourly scheduler secret outside source and bounds each run", () => {
    expect(automationMigration).toContain("vault.decrypted_secrets");
    expect(automationMigration).toContain("torres-integration-health-hourly");
    expect(scheduler).toContain("INTEGRATION_CRON_SECRET");
    expect(scheduler).toContain("MAX_CHECKS_PER_RUN = 25");
    expect(scheduler).toContain("crypto.subtle.digest");
    expect(scheduler).not.toMatch(/INTEGRATION_CRON_SECRET\s*[:=]\s*["'][^"']{32,}/);
  });
});
