import { buildTransactionalEmailHtml, type EmailEnv } from "./email";
import { loadGoogleConnection, readStoredGoogleComparison, readStoredGoogleMetrics, type GoogleMetricsEnv } from "./google-metrics";
import { sendTrackedEmail } from "./tracked-email";
import { nextReportRun, reportTypeLabel } from "../../lib/report-schedules";

type Env = GoogleMetricsEnv & EmailEnv;
type ScheduleRow = { id: string; organization_id: string; client_id: string; report_type: string; recipient_email: string; cadence: "weekly" | "monthly"; next_run_at: string; enabled: boolean; status: string };
const headers = (key: string, prefer?: string) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) });

function totals(snapshot: Awaited<ReturnType<typeof readStoredGoogleMetrics>>) {
  return { sessions: snapshot?.analytics?.totals.sessions || 0, conversions: snapshot?.analytics?.totals.conversions || 0, clicks: snapshot?.searchConsole?.totals.clicks || 0, impressions: snapshot?.searchConsole?.totals.impressions || 0 };
}

export async function processDueReportSchedules(env: Env, supabaseUrl: string, serviceKey: string, now = new Date()) {
  const response = await fetch(`${supabaseUrl}/rest/v1/report_schedules?enabled=eq.true&status=eq.active&next_run_at=lte.${encodeURIComponent(now.toISOString())}&select=id,organization_id,client_id,report_type,recipient_email,cadence,next_run_at&order=next_run_at.asc&limit=10`, { headers: headers(serviceKey) });
  if (!response.ok) return { due: 0, sent: 0, failed: 0, unavailable: true };
  const schedules = await response.json().catch(() => []) as ScheduleRow[];
  let sent = 0;
  let failed = 0;
  for (const schedule of schedules) {
    const existingResponse = await fetch(`${supabaseUrl}/rest/v1/report_schedule_runs?schedule_id=eq.${encodeURIComponent(schedule.id)}&scheduled_for=eq.${encodeURIComponent(schedule.next_run_at)}&select=id,status,snapshot_id&limit=1`, { headers: headers(serviceKey) });
    const existing = existingResponse.ok ? await existingResponse.json().catch(() => []) as Array<{ id?: string; status?: string; snapshot_id?: string | null }> : [];
    if (existing[0]?.status === "sent") {
      const reconciledAt = new Date().toISOString();
      await fetch(`${supabaseUrl}/rest/v1/report_schedules?id=eq.${encodeURIComponent(schedule.id)}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ next_run_at: nextReportRun(schedule.next_run_at, schedule.cadence), last_run_at: reconciledAt, updated_at: reconciledAt }) });
      continue;
    }
    let run = existing[0];
    if (run?.id) await fetch(`${supabaseUrl}/rest/v1/report_schedule_runs?id=eq.${encodeURIComponent(run.id)}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: "processing", error_detail: "", completed_at: null }) });
    else {
      const runResponse = await fetch(`${supabaseUrl}/rest/v1/report_schedule_runs`, { method: "POST", headers: headers(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: schedule.organization_id, client_id: schedule.client_id, schedule_id: schedule.id, scheduled_for: schedule.next_run_at, status: "processing" }) });
      const runs = runResponse.ok ? await runResponse.json().catch(() => []) as Array<{ id?: string; status?: string; snapshot_id?: string | null }> : [];
      run = runs[0];
    }
    if (!run?.id) { failed += 1; continue; }
    try {
      const [clientResponse, connection] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(schedule.client_id)}&select=name&limit=1`, { headers: headers(serviceKey) }),
        loadGoogleConnection(supabaseUrl, serviceKey, schedule.client_id),
      ]);
      const clients = clientResponse.ok ? await clientResponse.json().catch(() => []) as Array<{ name?: string }> : [];
      if (!clients[0]?.name || !connection) throw new Error("The scheduled report source is unavailable.");
      const [current, comparison] = await Promise.all([readStoredGoogleMetrics(env, schedule.client_id, connection, now), readStoredGoogleComparison(env, schedule.client_id, connection, now)]);
      if (!current?.available || !comparison) throw new Error("Current report observations are unavailable.");
      let snapshotId = run.snapshot_id || "";
      if (!snapshotId) {
        const snapshotResponse = await fetch(`${supabaseUrl}/rest/v1/report_snapshots`, { method: "POST", headers: headers(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: schedule.organization_id, client_id: schedule.client_id, report_type: schedule.report_type, period_start: comparison.current.range.startDate, period_end: comparison.current.range.endDate, comparison_start: comparison.previous.range.startDate, comparison_end: comparison.previous.range.endDate, payload: { version: 1, current, comparison, generated_at: now.toISOString(), source: "scheduled_delivery" } }) });
        const snapshots = snapshotResponse.ok ? await snapshotResponse.json().catch(() => []) as Array<{ id?: string }> : [];
        snapshotId = snapshots[0]?.id || "";
        if (!snapshotId) throw new Error("The scheduled report snapshot could not be saved.");
        const linkResponse = await fetch(`${supabaseUrl}/rest/v1/report_schedule_runs?id=eq.${encodeURIComponent(run.id)}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ snapshot_id: snapshotId }) });
        if (!linkResponse.ok) throw new Error("The scheduled report snapshot could not be linked to its delivery run.");
      }
      const values = totals(current);
      const heading = `${reportTypeLabel(schedule.report_type)} · ${clients[0].name}`;
      const body = `Reporting period: ${comparison.current.range.startDate} through ${comparison.current.range.endDate}\n\nGA4 sessions: ${values.sessions.toLocaleString()}\nSearch clicks: ${values.clicks.toLocaleString()}\nSearch impressions: ${values.impressions.toLocaleString()}\nGA4 conversions: ${values.conversions.toLocaleString()}\n\nThese figures were calculated from stored daily Google Analytics and Search Console observations. Sign in to review metric definitions, comparison periods, and source freshness.`;
      const delivery = await sendTrackedEmail(env, { supabaseUrl, serviceKey, organizationId: schedule.organization_id, clientId: schedule.client_id, recipient: schedule.recipient_email, subject: heading, text: body, html: buildTransactionalEmailHtml({ heading, body, action: { label: "Review secure report", url: "https://admin.torrescotechnology.com/reports/" } }), templateKey: "scheduled_report", idempotencyKey: `report-schedule:${schedule.id}:${schedule.next_run_at}` });
      if (!delivery.sent) throw new Error(delivery.error || "The scheduled report email was rejected.");
      const completedAt = new Date().toISOString();
      await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/report_schedule_runs?id=eq.${encodeURIComponent(run.id)}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: "sent", snapshot_id: snapshotId, email_delivery_id: delivery.deliveryId || null, completed_at: completedAt, error_detail: "" }) }),
        fetch(`${supabaseUrl}/rest/v1/report_schedules?id=eq.${encodeURIComponent(schedule.id)}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ next_run_at: nextReportRun(schedule.next_run_at, schedule.cadence), last_run_at: completedAt, updated_at: completedAt }) }),
      ]);
      sent += 1;
    } catch (error) {
      failed += 1;
      await fetch(`${supabaseUrl}/rest/v1/report_schedule_runs?id=eq.${encodeURIComponent(run.id)}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ status: "failed", error_detail: error instanceof Error ? error.message.slice(0, 500) : "Scheduled delivery failed.", completed_at: new Date().toISOString() }) }).catch(() => undefined);
    }
  }
  return { due: schedules.length, sent, failed, unavailable: false };
}
