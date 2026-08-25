import { requireAuth, getSupabaseUrl } from "../../_shared/auth";

interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type Connection = {
  google_email?: string;
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  search_console_site?: string | null;
  analytics_property?: string | null;
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function googleRequest(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body } as { ok: boolean; status: number; body: any };
}

function dateString(date: Date) { return date.toISOString().slice(0, 10); }
function metricNumber(row: any, index: number) { const value = Number(row?.metricValues?.[index]?.value); return Number.isFinite(value) ? value : 0; }

async function getAccessToken(connection: Connection, clientId: string, env: Env, supabaseUrl: string) {
  let accessToken = connection.access_token || "";
  const expiresSoon = connection.expires_at && new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (expiresSoon && connection.refresh_token && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: connection.refresh_token, grant_type: "refresh_token" }) });
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (response.ok && payload.access_token) {
      accessToken = payload.access_token;
      await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY || "", Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ""}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ access_token: accessToken, expires_at: new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }) });
    }
  }
  return accessToken;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client");
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Choose a valid client first." }, 400);
  const auth = await requireAuth(request, env, { clientId });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Report storage is not configured." }, 500);
  const connectionResponse = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=google_email,access_token,refresh_token,expires_at,search_console_site,analytics_property`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!connectionResponse.ok) return json({ error: "The Google connection could not be loaded." }, 502);
  const connection = (await connectionResponse.json() as Connection[])[0];
  if (!connection?.access_token) return json({ clientId, available: false, error: "Connect Google before loading report metrics." });
  const accessToken = await getAccessToken(connection, clientId, env, supabaseUrl);
  if (!accessToken) return json({ clientId, available: false, error: "Google authorization expired. Reconnect Google for this client." });

  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 27);
  const startDate = dateString(start); const endDate = dateString(end);
  const result: any = { clientId, googleEmail: connection.google_email || null, range: { startDate, endDate }, available: false, analytics: null, searchConsole: null, errors: [] };
  const requests: Promise<void>[] = [];

  if (connection.analytics_property) requests.push((async () => {
    const property = connection.analytics_property as string;
    const response = await googleRequest(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, accessToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateRanges: [{ startDate, endDate }], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }, { name: "engagementRate" }, { name: "conversions" }], limit: 31 }) });
    if (!response.ok) { result.errors.push(response.body?.error?.message || "Google Analytics metrics could not be loaded."); return; }
    const rows = Array.isArray(response.body?.rows) ? response.body.rows : [];
    const totals = rows.reduce((sum: any, row: any) => ({ sessions: sum.sessions + metricNumber(row, 0), activeUsers: sum.activeUsers + metricNumber(row, 1), pageViews: sum.pageViews + metricNumber(row, 2), conversions: sum.conversions + metricNumber(row, 4), engagementRateTotal: sum.engagementRateTotal + metricNumber(row, 3) }), { sessions: 0, activeUsers: 0, pageViews: 0, conversions: 0, engagementRateTotal: 0 });
    result.analytics = { property, totals: { sessions: totals.sessions, activeUsers: totals.activeUsers, pageViews: totals.pageViews, conversions: totals.conversions, engagementRate: rows.length ? totals.engagementRateTotal / rows.length : 0 } };
    result.available = true;
  })());

  if (connection.search_console_site) requests.push((async () => {
    const site = connection.search_console_site as string;
    const response = await googleRequest(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, accessToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, endDate, dimensions: ["date"], rowLimit: 31 }) });
    if (!response.ok) { result.errors.push(response.body?.error?.message || "Search Console metrics could not be loaded."); return; }
    const rows = Array.isArray(response.body?.rows) ? response.body.rows : [];
    const totals = rows.reduce((sum: any, row: any) => ({ clicks: sum.clicks + Number(row.clicks || 0), impressions: sum.impressions + Number(row.impressions || 0), positionTotal: sum.positionTotal + Number(row.position || 0) }), { clicks: 0, impressions: 0, positionTotal: 0 });
    result.searchConsole = { site, totals: { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.impressions ? totals.clicks / totals.impressions : 0, position: rows.length ? totals.positionTotal / rows.length : 0 } };
    result.available = true;
  })());

  if (!requests.length) result.errors.push("Save a Google Analytics or Search Console property mapping before loading reports.");
  await Promise.all(requests);
  return json(result);
};
