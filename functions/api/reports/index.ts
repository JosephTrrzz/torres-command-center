import { requireAuth, getSupabaseUrl, hasOrganizationPermission, type AuthContext } from "../../_shared/auth";
import { fetchGoogleMetrics, loadGoogleConnection, readStoredGoogleComparison, readStoredGoogleMetrics, type GoogleMetricsEnv } from "../../_shared/google-metrics";

type Env = GoogleMetricsEnv;
const reportTypes = new Set(["portfolio", "performance", "opportunities"]);

function serviceHeaders(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function writeScheduleLifecycle(url: string, serviceKey: string, context: AuthContext, organizationId: string, clientId: string, action: string, scheduleId: string, metadata: Record<string, unknown> = {}) {
  const payload = { client_id: clientId, ...metadata };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, actor_user_id: context.userId, action, entity_type: "report_schedule", entity_id: scheduleId, metadata: payload }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, event_type: action, aggregate_type: "report_schedule", aggregate_id: scheduleId, payload }) }),
  ]);
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client");
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Choose a valid client first." }, 400);
  const auth = await requireAuth(request, env, { clientId, permission: "reports.read" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Report storage is not configured." }, 500);
  const connection = await loadGoogleConnection(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, clientId);
  if (!connection?.access_token) return json({ clientId, available: false, error: "Connect Google before loading report metrics." });
  const stored = await readStoredGoogleMetrics(env, clientId, connection);
  if (stored) {
    const canManageSchedules = hasOrganizationPermission(auth.context, "automation.manage") && auth.context.organizationRole !== "client";
    const [snapshotsResponse, schedulesResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/report_snapshots?client_id=eq.${encodeURIComponent(clientId)}&select=id,report_type,period_start,period_end,created_at&order=created_at.desc&limit=5`, { headers: serviceHeaders(env.SUPABASE_SERVICE_ROLE_KEY) }),
      canManageSchedules ? fetch(`${supabaseUrl}/rest/v1/report_schedules?client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&select=id,report_type,recipient_email,cadence,next_run_at,enabled,last_run_at,created_at&order=created_at.desc`, { headers: serviceHeaders(env.SUPABASE_SERVICE_ROLE_KEY) }) : Promise.resolve(null),
    ]);
    const snapshots = snapshotsResponse.ok ? await snapshotsResponse.json().catch(() => []) : [];
    const schedules = schedulesResponse?.ok ? await schedulesResponse.json().catch(() => []) : [];
    return json({ ...stored, comparison: await readStoredGoogleComparison(env, clientId, connection), snapshots, schedules, canManageSchedules });
  }
  const live = await fetchGoogleMetrics(connection, clientId, env);
  return json(live.snapshot);
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as { action?: string; clientId?: string; reportType?: string; recipientEmail?: string; cadence?: string; nextRunAt?: string; scheduleId?: string; confirmation?: string } | null;
  const action = input?.action || "save_snapshot";
  const clientId = input?.clientId || "";
  const reportType = input?.reportType || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !reportTypes.has(reportType)) return json({ error: "Choose a valid client and report type." }, 400);
  const scheduleAction = ["create_schedule", "set_schedule_enabled", "archive_schedule"].includes(action);
  const auth = await requireAuth(request, env, { clientId, staffOnly: scheduleAction, permission: scheduleAction ? "automation.manage" : "reports.export" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const [clientResponse, connection] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=organization_id&limit=1`, { headers: serviceHeaders(serviceKey) }),
    loadGoogleConnection(supabaseUrl, serviceKey, clientId),
  ]);
  const clients = clientResponse.ok ? await clientResponse.json().catch(() => []) as Array<{ organization_id?: string }> : [];
  if (!clients[0]?.organization_id) return json({ error: "The report source could not be resolved." }, 404);
  const organizationId = clients[0].organization_id;

  if (action === "create_schedule") {
    const recipientEmail = (input?.recipientEmail || "").trim().toLowerCase();
    const cadence = input?.cadence || "";
    const nextRunAt = new Date(input?.nextRunAt || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail) || !["weekly", "monthly"].includes(cadence) || Number.isNaN(nextRunAt.getTime()) || nextRunAt.getTime() < Date.now() + 5 * 60_000) return json({ error: "Enter a valid recipient, cadence, and future first delivery time." }, 400);
    const response = await fetch(`${supabaseUrl}/rest/v1/report_schedules`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: clientId, report_type: reportType, recipient_email: recipientEmail, cadence, next_run_at: nextRunAt.toISOString(), enabled: false, created_by: auth.context.userId }) });
    if (!response.ok) return json({ error: "Apply the latest supabase/reporting.sql before creating a schedule." }, 502);
    const schedule = (await response.json().catch(() => []))[0] as { id?: string } | undefined;
    if (schedule?.id) await writeScheduleLifecycle(supabaseUrl, serviceKey, auth.context, organizationId, clientId, "report.schedule.created", schedule.id, { report_type: reportType, cadence });
    return json({ schedule, message: "Schedule saved as disabled. Review it before enabling delivery." }, 201);
  }

  if (action === "set_schedule_enabled" || action === "archive_schedule") {
    const scheduleId = input?.scheduleId || "";
    if (!/^[0-9a-f-]{36}$/i.test(scheduleId)) return json({ error: "Choose a valid report schedule." }, 400);
    const enabled = action === "set_schedule_enabled" && input?.confirmation === "ENABLE";
    if (action === "set_schedule_enabled" && input?.confirmation !== "ENABLE" && input?.confirmation !== "DISABLE") return json({ error: "Confirm ENABLE or DISABLE." }, 400);
    const response = await fetch(`${supabaseUrl}/rest/v1/report_schedules?id=eq.${encodeURIComponent(scheduleId)}&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify(action === "archive_schedule" ? { status: "archived", enabled: false, updated_at: new Date().toISOString() } : { enabled, updated_at: new Date().toISOString() }) });
    const rows = response.ok ? await response.json().catch(() => []) as unknown[] : [];
    if (!rows.length) return json({ error: "That schedule could not be updated." }, 404);
    await writeScheduleLifecycle(supabaseUrl, serviceKey, auth.context, organizationId, clientId, action === "archive_schedule" ? "report.schedule.archived" : enabled ? "report.schedule.enabled" : "report.schedule.disabled", scheduleId);
    return json({ schedule: rows[0], message: action === "archive_schedule" ? "Schedule archived." : enabled ? "Scheduled delivery enabled." : "Scheduled delivery disabled." });
  }

  if (action !== "save_snapshot") return json({ error: "This report action is not supported." }, 400);
  if (!connection) return json({ error: "Connect Google before saving a report snapshot." }, 409);
  const [current, comparison] = await Promise.all([readStoredGoogleMetrics(env, clientId, connection), readStoredGoogleComparison(env, clientId, connection)]);
  if (!current?.available || !comparison) return json({ error: "Synchronize report metrics before saving a snapshot." }, 409);
  const snapshotResponse = await fetch(`${supabaseUrl}/rest/v1/report_snapshots`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({ organization_id: organizationId, client_id: clientId, report_type: reportType, period_start: comparison.current.range.startDate, period_end: comparison.current.range.endDate, comparison_start: comparison.previous.range.startDate, comparison_end: comparison.previous.range.endDate, payload: { version: 1, current, comparison, generated_at: new Date().toISOString() }, created_by: auth.context.userId }),
  });
  if (!snapshotResponse.ok) {
    const failure = await snapshotResponse.json().catch(() => null) as { code?: string; message?: string } | null;
    console.error(JSON.stringify({ event: "report_snapshot_failed", status: snapshotResponse.status, code: failure?.code || "unknown", message: failure?.message || "unknown" }));
    return json({ error: failure?.message || "The report snapshot storage rejected this request.", code: failure?.code || "snapshot_failed" }, 502);
  }
  const rows = await snapshotResponse.json().catch(() => []) as Array<{ id?: string; created_at?: string }>;
  return json({ snapshot: rows[0] || null }, 201);
};
