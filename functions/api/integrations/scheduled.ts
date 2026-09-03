import { createNotification } from "../../_shared/notifications";
import { INTEGRATION_PROVIDERS, integrationAutomationState, type IntegrationHealth, type IntegrationProvider } from "../../../lib/integrations";
import { checkProvider, PROVIDERS, serviceHeaders, syncGoogleProviderMetrics, type ClientRow, type Env } from "./index";

type ScheduledConnection = {
  id?: string;
  client_id?: string;
  provider?: IntegrationProvider;
  automation_enabled?: boolean;
  check_interval_minutes?: number;
  next_check_at?: string | null;
  last_success_at?: string | null;
  consecutive_failures?: number;
  alert_opened_at?: string | null;
};

type HealthResult = {
  status: IntegrationHealth;
  detail: string;
  accountLabel: string;
  capabilities: string[];
};

const MAX_CHECKS_PER_RUN = 25;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function supabaseUrl(env: Env) {
  return (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
}

async function agencyOperators(url: string, serviceKey: string, organizationId: string) {
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=parent_organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const organizations = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as Array<{ parent_organization_id?: string | null }> : [];
  const agencyOrganizationId = organizations[0]?.parent_organization_id || organizationId;
  const response = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(agencyOrganizationId)}&status=eq.active&role=in.(owner,admin,operator)&select=user_id`, { headers: serviceHeaders(serviceKey) });
  const memberships = response.ok ? await response.json().catch(() => []) as Array<{ user_id?: string }> : [];
  return memberships.map((membership) => membership.user_id).filter((userId): userId is string => Boolean(userId));
}

async function writeAlertLifecycle(env: Env, url: string, serviceKey: string, input: {
  client: ClientRow & { organization_id: string };
  provider: IntegrationProvider;
  connectionId: string;
  requestId: string;
  opened: boolean;
  detail: string;
}) {
  const users = await agencyOperators(url, serviceKey, input.client.organization_id);
  const providerName = PROVIDERS[input.provider].name;
  const action = input.opened ? "integration.alert.opened" : "integration.alert.resolved";
  const title = input.opened ? `${providerName} needs attention` : `${providerName} recovered`;
  const body = input.opened
    ? `${input.client.name}: ${input.detail}`
    : `${input.client.name}: automated checks are responding normally again.`;
  await Promise.allSettled([
    ...users.map((userId) => createNotification(env, { userId, clientId: input.client.id, type: input.opened ? "action" : "system", title, body, href: `/integrations/?client=${encodeURIComponent(input.client.id)}` })),
    fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: input.client.organization_id, action, entity_type: "integration_connection", entity_id: input.connectionId, request_id: input.requestId, source: "scheduler", metadata: { client_id: input.client.id, provider: input.provider } }),
    }),
    fetch(`${url}/rest/v1/event_outbox`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: input.client.organization_id, event_type: action, aggregate_type: "integration_connection", aggregate_id: input.connectionId, payload: { client_id: input.client.id, provider: input.provider } }),
    }),
  ]);
}

async function persistScheduledCheck(env: Env, url: string, serviceKey: string, input: {
  client: ClientRow & { organization_id: string };
  provider: IntegrationProvider;
  existing?: ScheduledConnection;
  result: HealthResult;
  requestId: string;
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const automationState = integrationAutomationState(input.result.status, Number(input.existing?.consecutive_failures || 0), Boolean(input.existing?.alert_opened_at));
  const { succeeded, consecutiveFailures: failures } = automationState;
  const intervalMinutes = Math.min(10080, Math.max(15, Number(input.existing?.check_interval_minutes || 360)));
  const nextCheckAt = new Date(now.getTime() + intervalMinutes * 60 * 1000).toISOString();
  const alertWasOpen = Boolean(input.existing?.alert_opened_at);
  const openAlert = automationState.alertOpen;
  const connectionResponse = await fetch(`${url}/rest/v1/integration_connections?on_conflict=client_id,provider`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      organization_id: input.client.organization_id,
      client_id: input.client.id,
      provider: input.provider,
      scope: PROVIDERS[input.provider].scope,
      status: input.result.status,
      account_label: input.result.accountLabel,
      capabilities: input.result.capabilities,
      last_checked_at: nowIso,
      last_success_at: succeeded ? nowIso : input.existing?.last_success_at || null,
      last_error_at: succeeded ? null : nowIso,
      last_error_code: succeeded ? null : "provider_health_failed",
      last_error_message: succeeded ? null : input.result.detail,
      metadata: { health_detail: input.result.detail },
      automation_enabled: true,
      check_interval_minutes: intervalMinutes,
      next_check_at: nextCheckAt,
      consecutive_failures: failures,
      alert_opened_at: openAlert ? input.existing?.alert_opened_at || nowIso : null,
      alert_resolved_at: succeeded && alertWasOpen ? nowIso : undefined,
      last_trigger: "scheduled",
      updated_at: nowIso,
    }),
  });
  const connections = await connectionResponse.json().catch(() => []) as Array<{ id?: string }>;
  const connectionId = connections[0]?.id || "";
  if (!connectionResponse.ok || !connectionId) throw new Error("provider state could not be saved");

  const runResponse = await fetch(`${url}/rest/v1/integration_sync_runs`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: input.client.organization_id, client_id: input.client.id, connection_id: connectionId, provider: input.provider, operation: "health_check", trigger: "scheduled", status: succeeded ? "succeeded" : "failed", error_code: succeeded ? null : "provider_health_failed", error_message: succeeded ? null : input.result.detail, metadata: { request_id: input.requestId }, started_at: nowIso, completed_at: nowIso }),
  });
  if (!runResponse.ok) throw new Error("provider history could not be saved");

  if (automationState.alertOpened) await writeAlertLifecycle(env, url, serviceKey, { client: input.client, provider: input.provider, connectionId, requestId: input.requestId, opened: true, detail: input.result.detail });
  if (automationState.alertResolved) await writeAlertLifecycle(env, url, serviceKey, { client: input.client, provider: input.provider, connectionId, requestId: input.requestId, opened: false, detail: input.result.detail });
  return { succeeded, alertOpened: automationState.alertOpened, alertResolved: automationState.alertResolved, connectionId };
}

async function recordScheduledMetricSync(url: string, serviceKey: string, input: {
  client: ClientRow & { organization_id: string };
  connectionId: string;
  requestId: string;
  recordsRead: number;
  recordsWritten: number;
  errorMessage?: string;
}) {
  const now = new Date().toISOString();
  const response = await fetch(`${url}/rest/v1/integration_sync_runs`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({
      organization_id: input.client.organization_id,
      client_id: input.client.id,
      connection_id: input.connectionId,
      provider: "google",
      operation: "metrics_sync",
      trigger: "scheduled",
      status: input.errorMessage ? "failed" : "succeeded",
      records_read: input.recordsRead,
      records_written: input.recordsWritten,
      error_code: input.errorMessage ? "metrics_sync_failed" : null,
      error_message: input.errorMessage || null,
      metadata: { request_id: input.requestId },
      started_at: now,
      completed_at: now,
    }),
  });
  if (!response.ok) throw new Error("scheduled metric history could not be saved");
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const expectedSecret = env.INTEGRATION_CRON_SECRET?.trim() || "";
  const suppliedSecret = request.headers.get("x-torres-cron-secret")?.trim() || "";
  if (expectedSecret.length < 32 || suppliedSecret.length < 32 || !(await secureEqual(expectedSecret, suppliedSecret))) return json({ error: "Invalid scheduler credentials." }, 401);

  const url = supabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !serviceKey) return json({ error: "Scheduler data configuration is incomplete." }, 503);
  const requestId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const [clientsResponse, connectionsResponse] = await Promise.all([
    fetch(`${url}/rest/v1/clients?organization_id=not.is.null&select=id,name,organization_id&order=created_at.asc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/integration_connections?select=id,client_id,provider,automation_enabled,check_interval_minutes,next_check_at,last_success_at,consecutive_failures,alert_opened_at`, { headers: serviceHeaders(serviceKey) }),
  ]);
  if (!clientsResponse.ok || !connectionsResponse.ok) return json({ error: "Apply supabase/integration_automation.sql before enabling the scheduler." }, 503);
  const clients = await clientsResponse.json().catch(() => []) as Array<ClientRow & { organization_id: string }>;
  const connections = await connectionsResponse.json().catch(() => []) as ScheduledConnection[];
  const existingByKey = new Map(connections.map((connection) => [`${connection.client_id}:${connection.provider}`, connection]));
  const due = clients.flatMap((client) => INTEGRATION_PROVIDERS.map((provider) => ({ client, provider, existing: existingByKey.get(`${client.id}:${provider}`) })))
    .filter(({ existing }) => existing?.automation_enabled !== false && (!existing?.next_check_at || existing.next_check_at <= nowIso))
    .slice(0, MAX_CHECKS_PER_RUN);

  let checked = 0;
  let failed = 0;
  let metricsSynced = 0;
  let alertsOpened = 0;
  let alertsResolved = 0;
  for (let offset = 0; offset < due.length; offset += 4) {
    const results = await Promise.all(due.slice(offset, offset + 4).map(async ({ client, provider, existing }) => {
      try {
        let result = await checkProvider(provider, env, url, serviceKey, client.id);
        let metricResult: Awaited<ReturnType<typeof syncGoogleProviderMetrics>> | null = null;
        let metricError = "";
        let metricAttempted = false;
        if (provider === "google" && result.status === "connected" && existing?.id) {
          metricAttempted = true;
          try {
            metricResult = await syncGoogleProviderMetrics(env, client, existing.id);
          } catch (error) {
            metricError = error instanceof Error ? error.message : "Google report synchronization failed.";
            result = { ...result, status: "degraded", detail: metricError };
          }
        }
        const persisted = await persistScheduledCheck(env, url, serviceKey, { client, provider, existing, result, requestId });
        if (metricAttempted) await recordScheduledMetricSync(url, serviceKey, {
          client,
          connectionId: persisted.connectionId,
          requestId,
          recordsRead: metricResult?.recordsRead || 0,
          recordsWritten: metricResult?.recordsWritten || 0,
          errorMessage: metricError || undefined,
        });
        return { ...persisted, metricsSynced: metricResult?.recordsWritten || 0 };
      } catch (error) {
        console.error(JSON.stringify({ event: "integration_scheduled_check_failed", requestId, clientId: client.id, provider, error: error instanceof Error ? error.message : "unknown" }));
        return { succeeded: false, alertOpened: false, alertResolved: false, metricsSynced: 0 };
      }
    }));
    checked += results.length;
    failed += results.filter((result) => !result.succeeded).length;
    alertsOpened += results.filter((result) => result.alertOpened).length;
    alertsResolved += results.filter((result) => result.alertResolved).length;
    metricsSynced += results.reduce((total, result) => total + result.metricsSynced, 0);
  }

  console.log(JSON.stringify({ event: "integration_scheduler_complete", requestId, due: due.length, checked, failed, alertsOpened, alertsResolved, metricsSynced }));
  return json({ requestId, due: due.length, checked, failed, alertsOpened, alertsResolved, metricsSynced });
};
