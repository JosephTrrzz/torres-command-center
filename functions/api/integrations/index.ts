import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";
import { emailConfigured, type EmailEnv } from "../../_shared/email";
import { formspreeConfigured, type FormspreeEnv } from "../../_shared/formspree";
import { websiteIntakeConfigured, type WebsiteIntakeEnv } from "../../_shared/website-intake";
import { INTEGRATION_PROVIDERS, type IntegrationConnection, type IntegrationHealth, type IntegrationProvider, type IntegrationSyncRun, type IntegrationsSnapshot } from "../../../lib/integrations";

interface Env extends FunctionEnv, EmailEnv, FormspreeEnv, WebsiteIntakeEnv {}

type ClientRow = { id: string; name: string; organization_id?: string | null };
type GoogleRow = {
  google_email?: string;
  access_token?: string;
  business_profile_location?: string | null;
  search_console_site?: string | null;
  analytics_property?: string | null;
  updated_at?: string;
};
type RegistryRow = {
  id?: string;
  provider?: string;
  scope?: IntegrationConnection["scope"];
  status?: IntegrationHealth;
  account_label?: string;
  capabilities?: string[];
  last_checked_at?: string | null;
  last_success_at?: string | null;
  last_error_message?: string | null;
};
type RunRow = {
  id?: string;
  provider?: string;
  operation?: string;
  status?: IntegrationSyncRun["status"];
  records_read?: number;
  records_written?: number;
  error_message?: string | null;
  started_at?: string;
  completed_at?: string | null;
};

const PROVIDERS: Record<IntegrationProvider, Pick<IntegrationConnection, "name" | "category" | "description" | "scope" | "canReconnect" | "canDisconnect">> = {
  google: { name: "Google business data", category: "Analytics & search", description: "GA4, Search Console, and Business Profile resources mapped to this client.", scope: "client", canReconnect: true, canDisconnect: true },
  resend: { name: "Resend email", category: "Transactional email", description: "Onboarding, notifications, CRM replies, and delivery events from the verified agency domain.", scope: "organization", canReconnect: false, canDisconnect: false },
  website_intake: { name: "Website lead intake", category: "Forms & website chat", description: "Verified Formspree submissions and website conversations routed into the agency CRM.", scope: "organization", canReconnect: false, canDisconnect: false },
  supabase: { name: "Supabase", category: "Data & identity", description: "Authentication, tenant records, files, and operational data for Torres OS.", scope: "platform", canReconnect: false, canDisconnect: false },
  cloudflare: { name: "Cloudflare", category: "Hosting & edge", description: "Production pages, protected Functions, environment configuration, and edge delivery.", scope: "platform", canReconnect: false, canDisconnect: false },
};

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function isProvider(value: unknown): value is IntegrationProvider {
  return INTEGRATION_PROVIDERS.includes(value as IntegrationProvider);
}

function configured(value: string | undefined) {
  const normalized = value?.trim() || "";
  return Boolean(normalized && !/^(optional|replace-|your-)/i.test(normalized));
}

async function resolveClient(url: string, serviceKey: string, clientId: string) {
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,name,organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = await response.json().catch(() => []) as ClientRow[];
  if (!response.ok || !rows[0]) return null;
  if (rows[0].organization_id) return rows[0] as ClientRow & { organization_id: string };
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?legacy_client_id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const organizations = await organizationResponse.json().catch(() => []) as Array<{ id?: string }>;
  return organizations[0]?.id ? { ...rows[0], organization_id: organizations[0].id } : null;
}

async function readGoogle(url: string, serviceKey: string, clientId: string) {
  const response = await fetch(`${url}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=google_email,access_token,business_profile_location,search_console_site,analytics_property,updated_at&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = await response.json().catch(() => []) as GoogleRow[];
  return response.ok ? rows[0] ?? null : null;
}

function registryFor(provider: IntegrationProvider, rows: RegistryRow[]) {
  return rows.find((row) => row.provider === provider);
}

function providerConnection(provider: IntegrationProvider, env: Env, google: GoogleRow | null, registry: RegistryRow[]): IntegrationConnection {
  const definition = PROVIDERS[provider];
  const stored = registryFor(provider, registry);
  let status: IntegrationHealth = "disconnected";
  let statusDetail = "This provider has not been configured.";
  let accountLabel = "";
  let capabilities: string[] = [];

  if (provider === "google") {
    status = google?.access_token ? "connected" : "disconnected";
    statusDetail = google?.access_token ? "Google authorization is saved for this client." : "Connect Google to discover and map client properties.";
    accountLabel = google?.google_email || "";
    capabilities = [google?.analytics_property && "GA4", google?.search_console_site && "Search Console", google?.business_profile_location && "Business Profile"].filter(Boolean) as string[];
  } else if (provider === "resend") {
    status = emailConfigured(env) ? "connected" : "action_required";
    statusDetail = status === "connected" ? "The transactional email provider is configured." : "Add the verified Resend sender and API secret in Cloudflare.";
    accountLabel = configured(env.TRANSACTIONAL_EMAIL_FROM) ? env.TRANSACTIONAL_EMAIL_FROM!.trim() : "";
    capabilities = ["Transactional email", "Delivery webhooks", "CRM replies"];
  } else if (provider === "website_intake") {
    const intakeReady = websiteIntakeConfigured(env) || formspreeConfigured(env);
    status = intakeReady ? "connected" : "action_required";
    statusDetail = intakeReady ? "Verified website lead routing is configured." : "Complete the website intake or Formspree webhook configuration.";
    capabilities = ["Website forms", "Website chat", "CRM routing"];
  } else if (provider === "supabase") {
    status = configured(env.SUPABASE_SERVICE_ROLE_KEY) && Boolean(getSupabaseUrl(env)) ? "connected" : "action_required";
    statusDetail = status === "connected" ? "The protected data and identity layer is responding." : "Supabase environment configuration is incomplete.";
    capabilities = ["Authentication", "Tenant data", "Private files"];
  } else {
    status = "connected";
    statusDetail = "This request is running through the production Cloudflare edge.";
    capabilities = ["Pages", "Functions", "Edge delivery"];
  }

  if (stored?.status === "degraded" || stored?.status === "action_required") {
    status = stored.status;
    statusDetail = stored.last_error_message || statusDetail;
  }

  return {
    provider,
    ...definition,
    status,
    statusDetail,
    accountLabel: stored?.account_label || accountLabel,
    capabilities: stored?.capabilities?.length ? stored.capabilities : capabilities,
    lastCheckedAt: stored?.last_checked_at || (provider === "google" ? google?.updated_at || null : null),
    lastSuccessAt: stored?.last_success_at || null,
  };
}

function mapRun(row: RunRow): IntegrationSyncRun | null {
  if (!row.id || !isProvider(row.provider) || !row.started_at || !row.status) return null;
  return {
    id: row.id,
    provider: row.provider,
    operation: row.operation || "health_check",
    status: row.status,
    recordsRead: Number(row.records_read || 0),
    recordsWritten: Number(row.records_written || 0),
    errorMessage: row.error_message || "",
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
  };
}

async function buildSnapshot(env: Env, url: string, serviceKey: string, client: ClientRow & { organization_id: string }, canManage: boolean): Promise<IntegrationsSnapshot> {
  const [google, registryResponse, runsResponse] = await Promise.all([
    readGoogle(url, serviceKey, client.id),
    fetch(`${url}/rest/v1/integration_connections?client_id=eq.${encodeURIComponent(client.id)}&select=id,provider,scope,status,account_label,capabilities,last_checked_at,last_success_at,last_error_message`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/integration_sync_runs?client_id=eq.${encodeURIComponent(client.id)}&select=id,provider,operation,status,records_read,records_written,error_message,started_at,completed_at&order=started_at.desc&limit=12`, { headers: serviceHeaders(serviceKey) }),
  ]);
  const registryReady = registryResponse.ok && runsResponse.ok;
  const registry = registryResponse.ok ? await registryResponse.json().catch(() => []) as RegistryRow[] : [];
  const runRows = runsResponse.ok ? await runsResponse.json().catch(() => []) as RunRow[] : [];
  const connections = INTEGRATION_PROVIDERS.map((provider) => providerConnection(provider, env, google, registry));
  const now = Date.now();
  return {
    client: { id: client.id, name: client.name },
    canManage,
    registryReady,
    connections,
    runs: runRows.flatMap((row) => mapRun(row) || []),
    summary: {
      connected: connections.filter((connection) => connection.status === "connected").length,
      actionRequired: connections.filter((connection) => connection.status === "action_required" || connection.status === "degraded").length,
      checkedRecently: connections.filter((connection) => connection.lastCheckedAt && now - new Date(connection.lastCheckedAt).getTime() < 24 * 60 * 60 * 1000).length,
    },
  };
}

async function checkProvider(provider: IntegrationProvider, env: Env, url: string, serviceKey: string, clientId: string) {
  if (provider === "google") {
    const google = await readGoogle(url, serviceKey, clientId);
    if (!google?.access_token) return { status: "disconnected" as IntegrationHealth, detail: "Connect Google before running a health check.", accountLabel: "", capabilities: [] as string[] };
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${google.access_token}` } });
    const capabilities = [google.analytics_property && "GA4", google.search_console_site && "Search Console", google.business_profile_location && "Business Profile"].filter(Boolean) as string[];
    return response.ok
      ? { status: "connected" as IntegrationHealth, detail: "Google authorization responded successfully.", accountLabel: google.google_email || "", capabilities }
      : { status: "action_required" as IntegrationHealth, detail: "Google authorization expired. Reconnect this client.", accountLabel: google.google_email || "", capabilities };
  }
  if (provider === "resend") {
    if (!emailConfigured(env)) return { status: "action_required" as IntegrationHealth, detail: "Resend configuration is incomplete in Cloudflare.", accountLabel: "", capabilities: [] as string[] };
    const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}` } });
    return response.ok
      ? { status: "connected" as IntegrationHealth, detail: "Resend accepted the provider health request.", accountLabel: env.TRANSACTIONAL_EMAIL_FROM!.trim(), capabilities: ["Transactional email", "Delivery webhooks", "CRM replies"] }
      : { status: response.status === 401 ? "action_required" as IntegrationHealth : "degraded" as IntegrationHealth, detail: `Resend health check returned ${response.status}.`, accountLabel: env.TRANSACTIONAL_EMAIL_FROM!.trim(), capabilities: ["Transactional email"] };
  }
  if (provider === "website_intake") {
    const ready = websiteIntakeConfigured(env) || formspreeConfigured(env);
    return { status: ready ? "connected" as IntegrationHealth : "action_required" as IntegrationHealth, detail: ready ? "Website intake credentials and routing are configured." : "Website intake configuration is incomplete.", accountLabel: "", capabilities: ["Website forms", "Website chat", "CRM routing"] };
  }
  if (provider === "supabase") return { status: "connected" as IntegrationHealth, detail: "Supabase responded to the authenticated client lookup.", accountLabel: "", capabilities: ["Authentication", "Tenant data", "Private files"] };
  return { status: "connected" as IntegrationHealth, detail: "Cloudflare Pages Functions are responding at the production edge.", accountLabel: new URL("https://admin.torrescotechnology.com").host, capabilities: ["Pages", "Functions", "Edge delivery"] };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client") || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return authJson({ error: "Choose a valid client first." }, 400);
  const auth = await requireAuth(request, env, { staffOnly: true, clientId, permission: "integrations.read" });
  if ("response" in auth) return auth.response;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const client = await resolveClient(url, serviceKey, clientId);
  if (!client) return authJson({ error: "This client is not linked to an organization workspace." }, 409);
  const snapshot = await buildSnapshot(env, url, serviceKey, client, auth.context.permissions.includes("integrations.manage"));
  return authJson({ snapshot });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body = await request.json().catch(() => null) as { action?: unknown; clientId?: unknown; provider?: unknown; confirmation?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !isProvider(body?.provider) || (body?.action !== "check" && body?.action !== "disconnect")) return authJson({ error: "Choose a valid integration action." }, 400);
  const auth = await requireAuth(request, env, { staffOnly: true, clientId, permission: "integrations.manage" });
  if ("response" in auth) return auth.response;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const client = await resolveClient(url, serviceKey, clientId);
  if (!client) return authJson({ error: "This client is not linked to an organization workspace." }, 409);
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const existingConnectionResponse = await fetch(`${url}/rest/v1/integration_connections?client_id=eq.${encodeURIComponent(clientId)}&provider=eq.${body.provider}&select=id,last_success_at&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  if (!existingConnectionResponse.ok) return authJson({ error: "Apply supabase/integration_control.sql before managing provider health." }, 503);
  const existingConnectionRows = await existingConnectionResponse.json().catch(() => []) as Array<{ id?: string; last_success_at?: string | null }>;
  const existingConnection = existingConnectionRows[0];
  let result: Awaited<ReturnType<typeof checkProvider>>;

  if (body.action === "disconnect") {
    if (body.provider !== "google" || body.confirmation !== "DISCONNECT") return authJson({ error: "Only a confirmed Google disconnect is supported here." }, 400);
    const google = await readGoogle(url, serviceKey, clientId);
    if (google?.access_token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(google.access_token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => null);
    const deleteResponse = await fetch(`${url}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") });
    if (!deleteResponse.ok) return authJson({ error: "Google could not be disconnected safely." }, 502);
    result = { status: "disconnected", detail: "Google authorization and saved property mappings were removed.", accountLabel: "", capabilities: [] };
  } else {
    result = await checkProvider(body.provider, env, url, serviceKey, clientId);
  }

  const connectionResponse = await fetch(`${url}/rest/v1/integration_connections?on_conflict=client_id,provider`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      organization_id: client.organization_id,
      client_id: clientId,
      provider: body.provider,
      scope: PROVIDERS[body.provider].scope,
      status: result.status,
      account_label: result.accountLabel,
      capabilities: result.capabilities,
      last_checked_at: now,
      last_success_at: result.status === "connected" ? now : existingConnection?.last_success_at || null,
      last_error_at: result.status === "connected" || result.status === "disconnected" ? null : now,
      last_error_code: result.status === "connected" || result.status === "disconnected" ? null : "provider_health_failed",
      last_error_message: result.status === "connected" || result.status === "disconnected" ? null : result.detail,
      metadata: { health_detail: result.detail },
      created_by: auth.context.userId,
      updated_at: now,
    }),
  });
  const connectionRows = await connectionResponse.json().catch(() => []) as Array<{ id?: string }>;
  if (!connectionResponse.ok || !connectionRows[0]?.id) return authJson({ error: "Apply supabase/integration_control.sql before saving provider health." }, 503);

  const succeeded = result.status === "connected" || result.status === "disconnected";
  const runResponse = await fetch(`${url}/rest/v1/integration_sync_runs`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({
      organization_id: client.organization_id,
      client_id: clientId,
      connection_id: connectionRows[0].id,
      provider: body.provider,
      operation: body.action === "disconnect" ? "disconnect" : "health_check",
      trigger: "manual",
      status: succeeded ? "succeeded" : "failed",
      error_code: succeeded ? null : "provider_health_failed",
      error_message: succeeded ? null : result.detail,
      metadata: { request_id: requestId },
      initiated_by: auth.context.userId,
      started_at: now,
      completed_at: now,
    }),
  });
  if (!runResponse.ok) return authJson({ error: "Provider state was checked, but its history could not be recorded." }, 502);

  await fetch(`${url}/rest/v1/audit_events`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: client.organization_id, actor_user_id: auth.context.userId, action: `integration.${body.action}`, entity_type: "integration_connection", entity_id: connectionRows[0].id, request_id: requestId, metadata: { provider: body.provider, client_id: clientId, status: result.status } }),
  });
  console.log(JSON.stringify({ event: "integration_action", requestId, provider: body.provider, action: body.action, status: result.status, clientId }));
  return authJson({ message: result.detail });
};
