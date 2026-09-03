import { requireAuth, getSupabaseUrl } from "../../_shared/auth";
import { fetchGoogleMetrics, loadGoogleConnection, readStoredGoogleComparison, readStoredGoogleMetrics, type GoogleMetricsEnv } from "../../_shared/google-metrics";

type Env = GoogleMetricsEnv;
const reportTypes = new Set(["portfolio", "performance", "opportunities"]);

function serviceHeaders(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
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
    const snapshotsResponse = await fetch(`${supabaseUrl}/rest/v1/report_snapshots?client_id=eq.${encodeURIComponent(clientId)}&select=id,report_type,period_start,period_end,created_at&order=created_at.desc&limit=5`, { headers: serviceHeaders(env.SUPABASE_SERVICE_ROLE_KEY) });
    const snapshots = snapshotsResponse.ok ? await snapshotsResponse.json().catch(() => []) : [];
    return json({ ...stored, comparison: await readStoredGoogleComparison(env, clientId, connection), snapshots });
  }
  const live = await fetchGoogleMetrics(connection, clientId, env);
  return json(live.snapshot);
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as { clientId?: string; reportType?: string } | null;
  const clientId = input?.clientId || "";
  const reportType = input?.reportType || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !reportTypes.has(reportType)) return json({ error: "Choose a valid client and report type." }, 400);
  const auth = await requireAuth(request, env, { clientId, permission: "reports.export" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const [clientResponse, connection] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=organization_id&limit=1`, { headers: serviceHeaders(serviceKey) }),
    loadGoogleConnection(supabaseUrl, serviceKey, clientId),
  ]);
  const clients = clientResponse.ok ? await clientResponse.json().catch(() => []) as Array<{ organization_id?: string }> : [];
  if (!clients[0]?.organization_id || !connection) return json({ error: "The report source could not be resolved." }, 404);
  const [current, comparison] = await Promise.all([readStoredGoogleMetrics(env, clientId, connection), readStoredGoogleComparison(env, clientId, connection)]);
  if (!current?.available || !comparison) return json({ error: "Synchronize report metrics before saving a snapshot." }, 409);
  const snapshotResponse = await fetch(`${supabaseUrl}/rest/v1/report_snapshots`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({ organization_id: clients[0].organization_id, client_id: clientId, report_type: reportType, period_start: comparison.current.range.startDate, period_end: comparison.current.range.endDate, comparison_start: comparison.previous.range.startDate, comparison_end: comparison.previous.range.endDate, payload: { version: 1, current, comparison, generated_at: new Date().toISOString() }, created_by: auth.context.userId }),
  });
  if (!snapshotResponse.ok) {
    const failure = await snapshotResponse.json().catch(() => null) as { code?: string; message?: string } | null;
    console.error(JSON.stringify({ event: "report_snapshot_failed", status: snapshotResponse.status, code: failure?.code || "unknown", message: failure?.message || "unknown" }));
    return json({ error: failure?.message || "The report snapshot storage rejected this request.", code: failure?.code || "snapshot_failed" }, 502);
  }
  const rows = await snapshotResponse.json().catch(() => []) as Array<{ id?: string; created_at?: string }>;
  return json({ snapshot: rows[0] || null }, 201);
};
