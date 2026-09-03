import { afterEach, describe, expect, it, vi } from "vitest";
import { processDueReportSchedules } from "../functions/_shared/report-delivery";

const env = {} as Parameters<typeof processDueReportSchedules>[0];

afterEach(() => vi.unstubAllGlobals());

describe("scheduled report delivery worker", () => {
  it("does no work when no report schedule is due", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(processDueReportSchedules(env, "https://example.supabase.co", "service-key", new Date("2026-09-02T16:00:00.000Z"))).resolves.toEqual({ due: 0, sent: 0, failed: 0, unavailable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repairs a due schedule after its idempotent run was already sent", async () => {
    const schedule = { id: "schedule-1", organization_id: "org-1", client_id: "client-1", report_type: "portfolio", recipient_email: "recipient@example.com", cadence: "weekly", next_run_at: "2026-09-02T16:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([schedule]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "run-1", status: "sent", snapshot_id: "snapshot-1" }]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(processDueReportSchedules(env, "https://example.supabase.co", "service-key", new Date("2026-09-02T17:00:00.000Z"))).resolves.toEqual({ due: 1, sent: 0, failed: 0, unavailable: false });
    const update = fetchMock.mock.calls[2];
    expect(update[0]).toContain("report_schedules?id=eq.schedule-1");
    expect(JSON.parse(String(update[1]?.body))).toMatchObject({ next_run_at: "2026-09-09T16:00:00.000Z" });
  });
});
