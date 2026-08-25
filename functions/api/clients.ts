import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../_shared/auth";

interface Env extends FunctionEnv {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headers(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeUrl(value: string) {
  if (!value) return "";
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env, { staffOnly: true, permission: "clients.manage" });
  if ("response" in auth) return auth.response;
  const agency = auth.context.memberships.find((membership) => membership.organizationId === auth.context.organizationId && membership.kind === "agency" && membership.role !== "client")
    ?? auth.context.memberships.find((membership) => membership.kind === "agency" && membership.role !== "client");
  if (!agency || !uuidPattern.test(agency.organizationId)) return authJson({ error: "Open an agency workspace before creating a client." }, 409);

  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = clean(input?.name, 160);
  const industry = clean(input?.industry, 100);
  const location = clean(input?.location, 300);
  const website = normalizeUrl(clean(input?.website, 500));
  const email = clean(input?.email, 320).toLowerCase();
  const phone = clean(input?.phone, 60);
  const healthScore = Math.max(0, Math.min(100, Number(input?.health_score || 0)));
  if (!name || !industry || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || website === null || !Number.isFinite(healthScore)) {
    return authJson({ error: "Business name, industry, valid email, and valid website details are required." }, 400);
  }

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const schemaCheck = await fetch(`${url}/rest/v1/organization_onboarding?select=organization_id&limit=0`, { headers: headers(serviceKey) });
  if (!schemaCheck.ok) return authJson({ error: "Client onboarding storage is not ready. Apply supabase/client_onboarding.sql first." }, 503);

  const clientResponse = await fetch(`${url}/rest/v1/clients`, {
    method: "POST",
    headers: headers(serviceKey, "return=representation"),
    body: JSON.stringify({ name, industry, location, website, email, phone, health_score: healthScore }),
  });
  const clients = await clientResponse.json().catch(() => []) as Array<{ id?: string }>;
  const clientId = clients[0]?.id || "";
  if (!clientResponse.ok || !uuidPattern.test(clientId)) return authJson({ error: "The client record could not be created." }, 502);

  const organizationResponse = await fetch(`${url}/rest/v1/organizations`, {
    method: "POST",
    headers: headers(serviceKey, "return=representation"),
    body: JSON.stringify({
      name,
      slug: `client-${clientId.slice(0, 8)}`,
      kind: "client",
      parent_organization_id: agency.organizationId,
      legacy_client_id: clientId,
      status: "active",
      created_by: auth.context.userId,
    }),
  });
  const organizations = await organizationResponse.json().catch(() => []) as Array<{ id?: string }>;
  const organizationId = organizations[0]?.id || "";
  if (!organizationResponse.ok || !uuidPattern.test(organizationId)) {
    await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`, { method: "DELETE", headers: headers(serviceKey, "return=minimal") });
    return authJson({ error: "The client workspace could not be provisioned. No partial client was kept." }, 502);
  }

  const now = new Date().toISOString();
  const legacyPatch = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: headers(serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: organizationId }),
  });
  const seeds = await Promise.all([
    fetch(`${url}/rest/v1/business_profiles`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, client_id: clientId, legal_name: name, display_name: name, vertical: industry, website, primary_email: email, primary_phone: phone, status: "draft", created_by: auth.context.userId, updated_by: auth.context.userId }) }),
    fetch(`${url}/rest/v1/business_locations`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, client_id: clientId, location_key: "primary", name: "Primary location", city: location, service_area: location, is_primary: true }) }),
    fetch(`${url}/rest/v1/organization_onboarding`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, client_id: clientId, status: "not_started", current_step: 1, updated_by: auth.context.userId }) }),
  ]);
  if (!legacyPatch.ok || seeds.some((response) => !response.ok)) return authJson({ error: "The client exists, but its onboarding workspace needs repair before use.", clientId }, 502);

  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: agency.organizationId, actor_user_id: auth.context.userId, action: "client.created", entity_type: "client", entity_id: clientId, metadata: { client_organization_id: organizationId, email } }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: agency.organizationId, event_type: "client.created", aggregate_type: "client", aggregate_id: clientId, payload: { client_id: clientId, client_organization_id: organizationId } }) }),
  ]);
  return authJson({ client: { id: clientId, organization_id: organizationId, name, industry, location, website, email, phone, health_score: healthScore }, message: "Client workspace created. Onboarding and activation are ready." }, 201);
};
