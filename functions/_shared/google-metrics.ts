import { getSupabaseUrl, type FunctionEnv } from "./auth";

export interface GoogleMetricsEnv extends FunctionEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export type GoogleMetricsConnection = {
  google_email?: string;
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  search_console_site?: string | null;
  analytics_property?: string | null;
};

export type NormalizedMetricObservation = {
  provider: "google_analytics" | "google_search_console";
  resourceId: string;
  metricKey: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  unit: "count" | "ratio" | "rank";
  observedAt: string;
};

export type GoogleMetricsSnapshot = {
  clientId: string;
  googleEmail: string | null;
  range: { startDate: string; endDate: string };
  available: boolean;
  analytics: { property: string; totals: { sessions: number; activeUsers: number; pageViews: number; engagementRate: number; conversions: number } } | null;
  searchConsole: { site: string; totals: { clicks: number; impressions: number; ctr: number; position: number } } | null;
  errors: string[];
  freshness: { source: "live" | "stored"; syncedAt: string | null };
};

type GoogleMetricRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };
type SearchMetricRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
type GoogleErrorBody = { error?: { message?: string } };

function serviceHeaders(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

function configured(value: string | undefined) {
  const normalized = value?.trim() || "";
  return Boolean(normalized && !/^(optional|replace-|your-)/i.test(normalized));
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function reportRange(now = new Date(), days = 28, offsetDays = 0) {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1 - offsetDays);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: dateString(start), endDate: dateString(end) };
}

function metricNumber(row: GoogleMetricRow, index: number) {
  const value = Number(row.metricValues?.[index]?.value);
  return Number.isFinite(value) ? value : 0;
}

function providerDate(value: string | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

async function googleRequest<T>(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as T & GoogleErrorBody;
  return { ok: response.ok, status: response.status, body };
}

export async function loadGoogleConnection(supabaseUrl: string, serviceKey: string, clientId: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=google_email,access_token,refresh_token,expires_at,search_console_site,analytics_property&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as GoogleMetricsConnection[] : [];
  return rows[0] || null;
}

export async function getGoogleAccessToken(connection: GoogleMetricsConnection, clientId: string, env: GoogleMetricsEnv, supabaseUrl: string) {
  let accessToken = connection.access_token || "";
  const expiresSoon = connection.expires_at && new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (!expiresSoon) return accessToken;
  if (!connection.refresh_token || !configured(env.GOOGLE_CLIENT_ID) || !configured(env.GOOGLE_CLIENT_SECRET)) return "";

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: env.GOOGLE_CLIENT_SECRET!.trim(),
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok || !payload?.access_token) return "";
  accessToken = payload.access_token;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const saveResponse = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ access_token: accessToken, expires_at: new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }),
  });
  if (!saveResponse.ok) throw new Error("The refreshed Google authorization could not be saved.");
  return accessToken;
}

export async function fetchGoogleMetrics(connection: GoogleMetricsConnection, clientId: string, env: GoogleMetricsEnv, now = new Date()) {
  const supabaseUrl = getSupabaseUrl(env);
  const { startDate, endDate } = reportRange(now);
  const collectionRange = reportRange(now, 56);
  const snapshot: GoogleMetricsSnapshot = {
    clientId,
    googleEmail: connection.google_email || null,
    range: { startDate, endDate },
    available: false,
    analytics: null,
    searchConsole: null,
    errors: [],
    freshness: { source: "live", syncedAt: null },
  };
  const observations: NormalizedMetricObservation[] = [];
  const accessToken = await getGoogleAccessToken(connection, clientId, env, supabaseUrl);
  if (!accessToken) {
    snapshot.errors.push("Google authorization expired. Reconnect Google for this client.");
    return { snapshot, observations, recordsRead: 0 };
  }
  const observedAt = now.toISOString();
  let recordsRead = 0;
  const requests: Promise<void>[] = [];

  if (connection.analytics_property) requests.push((async () => {
    const property = connection.analytics_property!;
    const response = await googleRequest<{ rows?: GoogleMetricRow[] }>(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateRanges: [collectionRange], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }, { name: "engagementRate" }, { name: "conversions" }], limit: 62 }),
    });
    if (!response.ok) {
      snapshot.errors.push(response.body.error?.message || "Google Analytics metrics could not be loaded.");
      return;
    }
    const rows = Array.isArray(response.body.rows) ? response.body.rows : [];
    recordsRead += rows.length;
    const currentRows = rows.filter((row) => providerDate(row.dimensionValues?.[0]?.value) >= startDate);
    const totals = currentRows.reduce<{ sessions: number; activeUsers: number; pageViews: number; weightedEngagement: number; conversions: number }>((sum, row) => {
      const sessions = metricNumber(row, 0);
      return { sessions: sum.sessions + sessions, activeUsers: sum.activeUsers + metricNumber(row, 1), pageViews: sum.pageViews + metricNumber(row, 2), weightedEngagement: sum.weightedEngagement + metricNumber(row, 3) * sessions, conversions: sum.conversions + metricNumber(row, 4) };
    }, { sessions: 0, activeUsers: 0, pageViews: 0, weightedEngagement: 0, conversions: 0 });
    snapshot.analytics = { property, totals: { sessions: totals.sessions, activeUsers: totals.activeUsers, pageViews: totals.pageViews, engagementRate: totals.sessions ? totals.weightedEngagement / totals.sessions : 0, conversions: totals.conversions } };
    snapshot.available = true;
    const metricDefinitions = [
      ["sessions", 0, "count"], ["active_users", 1, "count"], ["page_views", 2, "count"], ["engagement_rate", 3, "ratio"], ["conversions", 4, "count"],
    ] as const;
    for (const row of rows) {
      const date = providerDate(row.dimensionValues?.[0]?.value);
      if (!date) continue;
      for (const [metricKey, index, unit] of metricDefinitions) observations.push({ provider: "google_analytics", resourceId: property, metricKey, periodStart: date, periodEnd: date, value: metricNumber(row, index), unit, observedAt });
    }
  })());

  if (connection.search_console_site) requests.push((async () => {
    const site = connection.search_console_site!;
    const response = await googleRequest<{ rows?: SearchMetricRow[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...collectionRange, dimensions: ["date"], rowLimit: 62 }),
    });
    if (!response.ok) {
      snapshot.errors.push(response.body.error?.message || "Search Console metrics could not be loaded.");
      return;
    }
    const rows = Array.isArray(response.body.rows) ? response.body.rows : [];
    recordsRead += rows.length;
    const currentRows = rows.filter((row) => (row.keys?.[0] || "") >= startDate);
    const totals = currentRows.reduce<{ clicks: number; impressions: number; weightedPosition: number }>((sum, row) => {
      const impressions = Number(row.impressions || 0);
      return { clicks: sum.clicks + Number(row.clicks || 0), impressions: sum.impressions + impressions, weightedPosition: sum.weightedPosition + Number(row.position || 0) * impressions };
    }, { clicks: 0, impressions: 0, weightedPosition: 0 });
    snapshot.searchConsole = { site, totals: { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.impressions ? totals.clicks / totals.impressions : 0, position: totals.impressions ? totals.weightedPosition / totals.impressions : 0 } };
    snapshot.available = true;
    for (const row of rows) {
      const date = row.keys?.[0] || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      observations.push(
        { provider: "google_search_console", resourceId: site, metricKey: "clicks", periodStart: date, periodEnd: date, value: Number(row.clicks || 0), unit: "count", observedAt },
        { provider: "google_search_console", resourceId: site, metricKey: "impressions", periodStart: date, periodEnd: date, value: Number(row.impressions || 0), unit: "count", observedAt },
        { provider: "google_search_console", resourceId: site, metricKey: "ctr", periodStart: date, periodEnd: date, value: Number(row.ctr || 0), unit: "ratio", observedAt },
        { provider: "google_search_console", resourceId: site, metricKey: "position", periodStart: date, periodEnd: date, value: Number(row.position || 0), unit: "rank", observedAt },
      );
    }
  })());

  if (!requests.length) snapshot.errors.push("Save a Google Analytics or Search Console property mapping before syncing metrics.");
  await Promise.all(requests);
  snapshot.freshness.syncedAt = snapshot.available ? observedAt : null;
  return { snapshot, observations, recordsRead };
}

export async function persistGoogleMetrics(input: {
  env: GoogleMetricsEnv;
  organizationId: string;
  clientId: string;
  connectionId: string;
  observations: NormalizedMetricObservation[];
}) {
  if (!input.observations.length) return 0;
  const url = getSupabaseUrl(input.env);
  const serviceKey = input.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const syncedAt = new Date().toISOString();
  const rows = input.observations.map((observation) => ({
    organization_id: input.organizationId,
    client_id: input.clientId,
    connection_id: input.connectionId,
    provider: observation.provider,
    resource_id: observation.resourceId,
    metric_key: observation.metricKey,
    period_start: observation.periodStart,
    period_end: observation.periodEnd,
    value: observation.value,
    unit: observation.unit,
    observed_at: observation.observedAt,
    synced_at: syncedAt,
    metadata: { normalized_version: 1 },
  }));
  const response = await fetch(`${url}/rest/v1/provider_metric_observations?on_conflict=client_id,provider,resource_id,metric_key,period_start,period_end`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error("Apply supabase/provider_metrics.sql before syncing normalized metrics.");
  return rows.length;
}

type StoredObservation = { provider?: string; resource_id?: string; metric_key?: string; value?: number | string; period_start?: string; synced_at?: string };

function summarizeStoredRows(rows: StoredObservation[], connection: GoogleMetricsConnection) {
  const analyticsRows = rows.filter((row) => row.provider === "google_analytics" && row.resource_id === connection.analytics_property);
  const searchRows = rows.filter((row) => row.provider === "google_search_console" && row.resource_id === connection.search_console_site);
  const sum = (source: StoredObservation[], key: string) => source.filter((row) => row.metric_key === key).reduce((total, row) => total + Number(row.value || 0), 0);
  const average = (source: StoredObservation[], key: string) => { const values = source.filter((row) => row.metric_key === key).map((row) => Number(row.value || 0)); return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; };
  const weightedAverage = (source: StoredObservation[], valueKey: string, weightKey: string) => {
    const values = new Map(source.filter((row) => row.metric_key === valueKey).map((row) => [row.period_start, Number(row.value || 0)]));
    const weights = source.filter((row) => row.metric_key === weightKey);
    const weightTotal = weights.reduce((total, row) => total + Number(row.value || 0), 0);
    return weightTotal ? weights.reduce((total, row) => total + (values.get(row.period_start) || 0) * Number(row.value || 0), 0) / weightTotal : average(source, valueKey);
  };
  const analytics = analyticsRows.length && connection.analytics_property ? { property: connection.analytics_property, totals: { sessions: sum(analyticsRows, "sessions"), activeUsers: sum(analyticsRows, "active_users"), pageViews: sum(analyticsRows, "page_views"), engagementRate: weightedAverage(analyticsRows, "engagement_rate", "sessions"), conversions: sum(analyticsRows, "conversions") } } : null;
  const impressions = sum(searchRows, "impressions");
  const clicks = sum(searchRows, "clicks");
  const searchConsole = searchRows.length && connection.search_console_site ? { site: connection.search_console_site, totals: { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: weightedAverage(searchRows, "position", "impressions") } } : null;
  return { analytics, searchConsole, analyticsRows, searchRows };
}

export async function readStoredGoogleMetrics(env: GoogleMetricsEnv, clientId: string, connection: GoogleMetricsConnection, now = new Date()) {
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const { startDate, endDate } = reportRange(now);
  const response = await fetch(`${url}/rest/v1/provider_metric_observations?client_id=eq.${encodeURIComponent(clientId)}&period_start=gte.${startDate}&period_start=lte.${endDate}&select=provider,resource_id,metric_key,value,period_start,synced_at&order=period_start.asc`, { headers: serviceHeaders(serviceKey) });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []) as StoredObservation[];
  if (!rows.length) return null;
  const { analytics, searchConsole, analyticsRows, searchRows } = summarizeStoredRows(rows, connection);
  const latestFor = (source: StoredObservation[]) => source.reduce<string | null>((latest, row) => !row.synced_at || (latest && row.synced_at <= latest) ? latest : row.synced_at, null);
  const errors = [connection.analytics_property && !analytics ? "The stored GA4 snapshot has not synchronized yet." : "", connection.search_console_site && !searchConsole ? "The stored Search Console snapshot has not synchronized yet." : ""].filter(Boolean);
  const providerSyncs = [analytics ? latestFor(analyticsRows) : null, searchConsole ? latestFor(searchRows) : null].filter((value): value is string => Boolean(value));
  const latestSync = providerSyncs.length ? providerSyncs.reduce((oldest, value) => value < oldest ? value : oldest) : null;
  return {
    clientId,
    googleEmail: connection.google_email || null,
    range: { startDate, endDate },
    available: Boolean(analytics || searchConsole),
    analytics,
    searchConsole,
    errors,
    freshness: { source: "stored" as const, syncedAt: latestSync },
  } satisfies GoogleMetricsSnapshot;
}

export async function readStoredGoogleComparison(env: GoogleMetricsEnv, clientId: string, connection: GoogleMetricsConnection, now = new Date()) {
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const current = reportRange(now);
  const previous = reportRange(now, 28, 28);
  const response = await fetch(`${url}/rest/v1/provider_metric_observations?client_id=eq.${encodeURIComponent(clientId)}&period_start=gte.${previous.startDate}&period_start=lte.${current.endDate}&select=provider,resource_id,metric_key,value,period_start,synced_at&order=period_start.asc`, { headers: serviceHeaders(serviceKey) });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []) as StoredObservation[];
  const currentRows = rows.filter((row) => (row.period_start || "") >= current.startDate);
  const previousRows = rows.filter((row) => (row.period_start || "") >= previous.startDate && (row.period_start || "") <= previous.endDate);
  const currentSummary = summarizeStoredRows(currentRows, connection);
  const previousSummary = summarizeStoredRows(previousRows, connection);
  return {
    current: { range: current, analytics: currentSummary.analytics, searchConsole: currentSummary.searchConsole },
    previous: { range: previous, analytics: previousSummary.analytics, searchConsole: previousSummary.searchConsole },
    coverage: { currentDays: new Set(currentRows.map((row) => row.period_start)).size, previousDays: new Set(previousRows.map((row) => row.period_start)).size },
  };
}
