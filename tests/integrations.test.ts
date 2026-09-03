import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { interpretResendHealth } from "../functions/api/integrations/index";
import { INTEGRATION_PROVIDERS, integrationAutomationState, integrationScopeLabel, integrationStatusLabel } from "../lib/integrations";

const api = readFileSync(join(process.cwd(), "functions", "api", "integrations", "index.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase", "integration_control.sql"), "utf8");
const automationMigration = readFileSync(join(process.cwd(), "supabase", "integration_automation.sql"), "utf8");
const scheduler = readFileSync(join(process.cwd(), "functions", "api", "integrations", "scheduled.ts"), "utf8");
const metricsMigration = readFileSync(join(process.cwd(), "supabase", "provider_metrics.sql"), "utf8");
const reportsApi = readFileSync(join(process.cwd(), "functions", "api", "reports", "index.ts"), "utf8");

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

  it("recognizes a least-privilege Resend sending key without hiding invalid credentials", () => {
    expect(interpretResendHealth(401, false, { name: "restricted_api_key" }, "Team <notifications@example.com>")).toMatchObject({
      status: "connected",
      detail: "Resend accepted the configured sending-only credential.",
    });
    expect(interpretResendHealth(401, false, { name: "missing_api_key" }, "Team <notifications@example.com>").status).toBe("action_required");
    expect(interpretResendHealth(403, false, { name: "invalid_api_key" }, "Team <notifications@example.com>").status).toBe("action_required");
    expect(interpretResendHealth(500, false, {}, "Team <notifications@example.com>").status).toBe("degraded");
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

  it("stores normalized provider observations behind tenant RLS", () => {
    expect(metricsMigration).toContain("provider_metric_observations");
    expect(metricsMigration).toContain("can_access_organization(organization_id)");
    expect(metricsMigration).toContain("unique (client_id, provider, resource_id, metric_key, period_start, period_end)");
    expect(metricsMigration).toContain("provider_metric_observations_scope_guard");
    expect(metricsMigration).not.toMatch(/\b(access_token|refresh_token|api_key|webhook_secret)\s+text\b/);
  });

  it("uses one adapter for manual and scheduled Google sync while reports prefer stored observations", () => {
    expect(api).toContain("syncGoogleProviderMetrics");
    expect(api).toContain('body.action === "sync"');
    expect(api).toContain('authJson({ error: responseMessage }, 502)');
    expect(scheduler).toContain("syncGoogleProviderMetrics");
    expect(scheduler).toContain("metricAttempted");
    expect(reportsApi).toContain("readStoredGoogleMetrics");
    expect(reportsApi.indexOf("readStoredGoogleMetrics")).toBeLessThan(reportsApi.indexOf("fetchGoogleMetrics(connection"));
  });
});
