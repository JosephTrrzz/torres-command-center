import { authJson, getSupabaseUrl, hasOrganizationPermission, requireAuth, type FunctionEnv } from "../_shared/auth";
import { isValidEmail, normalizeEmail } from "../../lib/email";

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
  const email = normalizeEmail(input?.email);
  const phone = clean(input?.phone, 60);
  const healthScore = Math.max(0, Math.min(100, Number(input?.health_score || 0)));
  if (!name || !industry || !isValidEmail(email) || website === null || !Number.isFinite(healthScore)) {
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

export const onRequestPatch = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const clientId = clean(input?.clientId, 64);
  if (!uuidPattern.test(clientId)) return authJson({ error: "Choose a valid client before saving." }, 400);

  const auth = await requireAuth(request, env, { clientId });
  if ("response" in auth) return auth.response;
  const customerSelf = auth.context.clientId === clientId
    && (auth.context.role === "customer" || auth.context.organizationRole === "client");
  if (!customerSelf && !hasOrganizationPermission(auth.context, "clients.manage")) {
    return authJson({ error: "Your role cannot update this client profile." }, 403);
  }

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const currentResponse = await fetch(
    `${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,name,industry,location,website,email,phone,health_score&limit=1`,
    { headers: headers(serviceKey) },
  );
  const currentRows = await currentResponse.json().catch(() => []) as Array<Record<string, unknown>>;
  const current = currentRows[0];
  if (!currentResponse.ok || !current) return authJson({ error: "This client record could not be loaded." }, 404);

  const name = clean(input?.name ?? current.name, 160);
  const industry = clean(input?.industry ?? current.industry, 100);
  const location = clean(input?.location ?? current.location, 300);
  const website = normalizeUrl(clean(input?.website ?? current.website, 500));
  const email = normalizeEmail(input?.email ?? current.email);
  const phone = clean(input?.phone ?? current.phone, 60);
  const requestedHealthScore = Number(input?.health_score ?? current.health_score ?? 0);
  const healthScore = customerSelf
    ? Math.max(0, Math.min(100, Number(current.health_score ?? 0)))
    : Math.max(0, Math.min(100, requestedHealthScore));
  if (!name || !industry || !isValidEmail(email) || website === null || !Number.isFinite(healthScore)) {
    return authJson({ error: "Business name, industry, valid contact email, and valid website details are required." }, 400);
  }

  const now = new Date().toISOString();
  const clientResponse = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: headers(serviceKey, "return=representation"),
    body: JSON.stringify({ name, industry, location, website, email, phone, health_score: healthScore }),
  });
  const savedRows = await clientResponse.json().catch(() => []) as Array<Record<string, unknown>>;
  if (!clientResponse.ok || !savedRows[0]) return authJson({ error: "The client profile could not be saved." }, 502);

  const organizationId = typeof current.organization_id === "string" ? current.organization_id : "";
  if (uuidPattern.test(organizationId)) {
    const profileResponse = await fetch(`${url}/rest/v1/business_profiles?on_conflict=organization_id`, {
      method: "POST",
      headers: headers(serviceKey, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify({
        organization_id: organizationId,
        client_id: clientId,
        legal_name: name,
        display_name: name,
        vertical: industry,
        website,
        primary_email: email,
        primary_phone: phone,
        updated_by: auth.context.userId,
        updated_at: now,
      }),
    });
    if (!profileResponse.ok) return authJson({ error: "The client record saved, but its business profile could not be synchronized." }, 502);
  }

  const emailChanged = normalizeEmail(current.email) !== email;
  if (uuidPattern.test(organizationId)) {
    await fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: headers(serviceKey, "return=minimal"),
      body: JSON.stringify({
        organization_id: organizationId,
        actor_user_id: auth.context.userId,
        action: emailChanged ? "client.email.updated" : "client.profile.updated",
        entity_type: "client",
        entity_id: clientId,
        metadata: { changed_fields: Object.keys(input || {}).filter((key) => key !== "clientId"), email_changed: emailChanged },
      }),
    }).catch(() => undefined);
  }

  return authJson({
    client: savedRows[0],
    message: emailChanged
      ? "Client email saved to Supabase and synchronized with the business profile."
      : "Client profile saved to Supabase.",
  });
};
