import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGoogleMetrics, readStoredGoogleComparison, readStoredGoogleMetrics, reportRange } from "../functions/_shared/google-metrics";

const env = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalized Google metrics", () => {
  it("builds adjacent complete comparison periods", () => {
    expect(reportRange(new Date("2026-08-29T12:00:00.000Z"))).toEqual({ startDate: "2026-08-01", endDate: "2026-08-28" });
    expect(reportRange(new Date("2026-08-29T12:00:00.000Z"), 28, 28)).toEqual({ startDate: "2026-07-04", endDate: "2026-07-31" });
  });
  it("normalizes daily provider rows and weights multi-day rates", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("analyticsdata.googleapis.com")) return new Response(JSON.stringify({ rows: [
        { dimensionValues: [{ value: "20260801" }], metricValues: [{ value: "10" }, { value: "8" }, { value: "15" }, { value: "0.5" }, { value: "1" }] },
        { dimensionValues: [{ value: "20260802" }], metricValues: [{ value: "30" }, { value: "20" }, { value: "45" }, { value: "1" }, { value: "2" }] },
      ] }), { status: 200 });
      if (url.includes("webmasters")) return new Response(JSON.stringify({ rows: [
        { keys: ["2026-08-01"], clicks: 5, impressions: 100, ctr: 0.05, position: 10 },
        { keys: ["2026-08-02"], clicks: 15, impressions: 300, ctr: 0.05, position: 2 },
      ] }), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);

    const result = await fetchGoogleMetrics({
      google_email: "owner@example.com",
      access_token: "access-token",
      expires_at: "2099-01-01T00:00:00.000Z",
      analytics_property: "properties/123",
      search_console_site: "sc-domain:example.com",
    }, "00000000-0000-0000-0000-000000000001", env, new Date("2026-08-29T12:00:00.000Z"));

    expect(result.snapshot.analytics?.totals).toMatchObject({ sessions: 40, activeUsers: 28, pageViews: 60, engagementRate: 0.875, conversions: 3 });
    expect(result.snapshot.searchConsole?.totals).toMatchObject({ clicks: 20, impressions: 400, ctr: 0.05, position: 4 });
    expect(result.observations).toHaveLength(18);
    expect(result.observations[0]).toMatchObject({ provider: "google_analytics", metricKey: "sessions", periodStart: "2026-08-01" });
  });

  it("rebuilds the same weighted totals from stored observations", async () => {
    const rows = [
      ["2026-08-01", "sessions", 10], ["2026-08-01", "engagement_rate", 0.5],
      ["2026-08-02", "sessions", 30], ["2026-08-02", "engagement_rate", 1],
    ].map(([period_start, metric_key, value]) => ({ provider: "google_analytics", resource_id: "properties/123", period_start, metric_key, value, synced_at: "2026-08-29T12:00:00.000Z" }));
    rows.push(...[
      ["2026-08-01", "impressions", 100], ["2026-08-01", "position", 10],
      ["2026-08-02", "impressions", 300], ["2026-08-02", "position", 2],
      ["2026-08-01", "clicks", 5], ["2026-08-02", "clicks", 15],
    ].map(([period_start, metric_key, value]) => ({ provider: "google_search_console", resource_id: "sc-domain:example.com", period_start, metric_key, value, synced_at: "2026-08-29T12:00:00.000Z" })));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));

    const stored = await readStoredGoogleMetrics(env, "00000000-0000-0000-0000-000000000001", {
      analytics_property: "properties/123",
      search_console_site: "sc-domain:example.com",
    }, new Date("2026-08-29T12:00:00.000Z"));

    expect(stored?.freshness).toEqual({ source: "stored", syncedAt: "2026-08-29T12:00:00.000Z" });
    expect(stored?.analytics?.totals.engagementRate).toBe(0.875);
    expect(stored?.searchConsole?.totals).toMatchObject({ clicks: 20, impressions: 400, ctr: 0.05, position: 4 });
  });

  it("separates current and previous observations without treating missing days as zero", async () => {
    const rows = [
      { provider: "google_analytics", resource_id: "properties/123", period_start: "2026-07-31", metric_key: "sessions", value: 5, synced_at: "2026-08-29T12:00:00.000Z" },
      { provider: "google_analytics", resource_id: "properties/123", period_start: "2026-08-01", metric_key: "sessions", value: 9, synced_at: "2026-08-29T12:00:00.000Z" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    const comparison = await readStoredGoogleComparison(env, "00000000-0000-0000-0000-000000000001", { analytics_property: "properties/123" }, new Date("2026-08-29T12:00:00.000Z"));
    expect(comparison?.current.analytics?.totals.sessions).toBe(9);
    expect(comparison?.previous.analytics?.totals.sessions).toBe(5);
    expect(comparison?.coverage).toEqual({ currentDays: 1, previousDays: 1 });
  });
});
