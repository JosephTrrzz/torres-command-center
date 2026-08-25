import {
  canCompleteOnboarding,
  isOnboardingStep,
  nextOnboardingStep,
  onboardingCompletion,
  orderedOnboardingSteps,
  type OnboardingBusiness,
  type OnboardingGoal,
  type OnboardingLocation,
  type OnboardingService,
  type OnboardingStepKey,
} from "../../../lib/onboarding";
import { authJson, getSupabaseUrl, hasOrganizationPermission, requireAuth, type FunctionEnv } from "../../_shared/auth";

interface Env extends FunctionEnv {}

type ClientRow = {
  id: string;
  organization_id: string | null;
  name: string;
  industry: string | null;
  location: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
};

type ProgressRow = {
  status?: "not_started" | "in_progress" | "complete";
  current_step?: number;
  completed_steps?: string[];
  skipped_steps?: string[];
  completion_percent?: number;
  step_data?: Record<string, unknown>;
  updated_at?: string | null;
  completed_at?: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validOptionalUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validOptionalEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeBusiness(value: unknown): OnboardingBusiness | null {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const business = {
    legalName: cleanText(input.legalName, 160),
    displayName: cleanText(input.displayName, 120),
    vertical: cleanText(input.vertical, 80),
    tagline: cleanText(input.tagline, 180),
    description: cleanText(input.description, 2000),
    website: cleanText(input.website, 500),
    email: cleanText(input.email, 320).toLowerCase(),
    phone: cleanText(input.phone, 60),
  };
  if (!business.displayName || !business.vertical || !validOptionalUrl(business.website) || !validOptionalEmail(business.email)) return null;
  return business;
}

function normalizeLocation(value: unknown): OnboardingLocation | null {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const countryCode = cleanText(input.countryCode, 2).toUpperCase() || "US";
  const location = {
    name: cleanText(input.name, 120) || "Primary location",
    streetAddress: cleanText(input.streetAddress, 240),
    city: cleanText(input.city, 120),
    region: cleanText(input.region, 100),
    postalCode: cleanText(input.postalCode, 30),
    countryCode,
    serviceArea: cleanText(input.serviceArea, 500),
  };
  if (!location.city || !/^[A-Z]{2}$/.test(location.countryCode)) return null;
  return location;
}

function normalizeServices(value: unknown): OnboardingService[] | null {
  if (!Array.isArray(value) || value.length > 25) return null;
  const rows = value.map((item) => {
    const input = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { name: cleanText(input.name, 160), description: cleanText(input.description, 1000), category: cleanText(input.category, 100) };
  }).filter((item) => item.name);
  if (!rows.length || new Set(rows.map((item) => item.name.toLowerCase())).size !== rows.length) return null;
  return rows;
}

const goalTypes = new Set(["leads", "revenue", "appointments", "visibility", "reviews", "operations", "business"]);

function normalizeGoals(value: unknown): OnboardingGoal[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const rows = value.map((item) => {
    const input = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const goalType = cleanText(input.goalType, 30);
    const numericTarget = typeof input.targetValue === "number" && Number.isFinite(input.targetValue) ? input.targetValue : null;
    return {
      goalType: (goalTypes.has(goalType) ? goalType : "business") as OnboardingGoal["goalType"],
      title: cleanText(input.title, 200),
      targetValue: numericTarget,
      targetUnit: cleanText(input.targetUnit, 80),
      targetDate: /^\d{4}-\d{2}-\d{2}$/.test(cleanText(input.targetDate, 10)) ? cleanText(input.targetDate, 10) : "",
    };
  }).filter((item) => item.title);
  return rows.length ? rows : null;
}

async function getClient(url: string, serviceKey: string, clientId: string) {
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,name,industry,location,website,email,phone&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = await response.json().catch(() => []) as ClientRow[];
  return response.ok ? rows[0] || null : null;
}

async function readSnapshot(url: string, serviceKey: string, client: ClientRow) {
  if (!client.organization_id) return null;
  const organizationId = client.organization_id;
  const headers = serviceHeaders(serviceKey);
  const [profileResponse, locationResponse, servicesResponse, goalsResponse, progressResponse] = await Promise.all([
    fetch(`${url}/rest/v1/business_profiles?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&limit=1`, { headers }),
    fetch(`${url}/rest/v1/business_locations?organization_id=eq.${encodeURIComponent(organizationId)}&location_key=eq.primary&select=*&limit=1`, { headers }),
    fetch(`${url}/rest/v1/business_services?organization_id=eq.${encodeURIComponent(organizationId)}&active=eq.true&select=*&order=sort_order.asc,name.asc`, { headers }),
    fetch(`${url}/rest/v1/business_goals?organization_id=eq.${encodeURIComponent(organizationId)}&status=in.(draft,active)&select=*&order=sort_order.asc,created_at.asc`, { headers }),
    fetch(`${url}/rest/v1/organization_onboarding?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&limit=1`, { headers }),
  ]);
  if (![profileResponse, locationResponse, servicesResponse, goalsResponse, progressResponse].every((response) => response.ok)) return null;
  const [profileRows, locationRows, serviceRows, goalRows, progressRows] = await Promise.all([
    profileResponse.json() as Promise<Array<Record<string, unknown>>>,
    locationResponse.json() as Promise<Array<Record<string, unknown>>>,
    servicesResponse.json() as Promise<Array<Record<string, unknown>>>,
    goalsResponse.json() as Promise<Array<Record<string, unknown>>>,
    progressResponse.json() as Promise<ProgressRow[]>,
  ]);
  const profile = profileRows[0] || {};
  const location = locationRows[0] || {};
  const progress = progressRows[0] || {};
  const completedSteps = orderedOnboardingSteps(progress.completed_steps || []);
  const skippedSteps = orderedOnboardingSteps(progress.skipped_steps || []);
  return {
    clientId: client.id,
    organizationId,
    status: progress.status || "not_started",
    currentStep: progress.current_step || nextOnboardingStep(completedSteps, skippedSteps),
    completedSteps,
    skippedSteps,
    completionPercent: progress.completion_percent ?? onboardingCompletion(completedSteps, skippedSteps),
    data: {
      business: {
        legalName: String(profile.legal_name || client.name || ""),
        displayName: String(profile.display_name || client.name || ""),
        vertical: String(profile.vertical || client.industry || ""),
        tagline: String(profile.tagline || ""),
        description: String(profile.description || ""),
        website: String(profile.website || client.website || ""),
        email: String(profile.primary_email || client.email || ""),
        phone: String(profile.primary_phone || client.phone || ""),
      },
      location: {
        name: String(location.name || "Primary location"),
        streetAddress: String(location.street_address || ""),
        city: String(location.city || client.location || ""),
        region: String(location.region || ""),
        postalCode: String(location.postal_code || ""),
        countryCode: String(location.country_code || "US"),
        serviceArea: String(location.service_area || ""),
      },
      services: serviceRows.map((row) => ({ name: String(row.name || ""), description: String(row.description || ""), category: String(row.category || "") })),
      goals: goalRows.map((row) => ({
        goalType: (goalTypes.has(String(row.goal_type)) ? String(row.goal_type) : "business") as OnboardingGoal["goalType"],
        title: String(row.title || ""),
        targetValue: typeof row.target_value === "number" ? row.target_value : row.target_value === null || row.target_value === undefined ? null : Number(row.target_value),
        targetUnit: String(row.target_unit || ""),
        targetDate: String(row.target_date || ""),
      })),
    },
    updatedAt: progress.updated_at || null,
    completedAt: progress.completed_at || null,
  };
}

async function upsert(url: string, serviceKey: string, table: string, conflict: string, body: Record<string, unknown>) {
  return fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(body),
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const preliminary = await requireAuth(request, env);
  if ("response" in preliminary) return preliminary.response;
  const requestedClientId = clientId || preliminary.context.clientId || "";
  if (!uuidPattern.test(requestedClientId)) return authJson({ error: "Choose a client before opening onboarding." }, 400);
  const auth = await requireAuth(request, env, { clientId: requestedClientId });
  if ("response" in auth) return auth.response;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const client = await getClient(url, serviceKey, requestedClientId);
  if (!client?.organization_id) return authJson({ error: "This client is not linked to an organization workspace." }, 409);
  const snapshot = await readSnapshot(url, serviceKey, client);
  if (!snapshot) return authJson({ error: "Client onboarding storage is not ready. Apply supabase/client_onboarding.sql." }, 503);
  return authJson({ onboarding: snapshot });
};

export const onRequestPatch = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as { clientId?: unknown; step?: unknown; data?: unknown; skipped?: unknown; complete?: unknown } | null;
  const clientId = typeof input?.clientId === "string" ? input.clientId : "";
  if (!uuidPattern.test(clientId) || !isOnboardingStep(input?.step)) return authJson({ error: "A valid client and onboarding step are required." }, 400);
  const auth = await requireAuth(request, env, { clientId });
  if ("response" in auth) return auth.response;
  const customerSelf = auth.context.clientId === clientId && (auth.context.role === "customer" || auth.context.organizationRole === "client");
  if (!customerSelf && !hasOrganizationPermission(auth.context, "clients.manage")) return authJson({ error: "Your role cannot update this onboarding profile." }, 403);

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const client = await getClient(url, serviceKey, clientId);
  if (!client?.organization_id) return authJson({ error: "This client is not linked to an organization workspace." }, 409);
  const organizationId = client.organization_id;
  const step = input.step;
  const skipped = input.skipped === true && (step === "services" || step === "goals");
  const now = new Date().toISOString();
  let writeResponse: Response | null = null;

  if (step === "business") {
    const business = normalizeBusiness(input.data);
    if (!business) return authJson({ error: "Business name, industry, and valid contact details are required." }, 400);
    writeResponse = await upsert(url, serviceKey, "business_profiles", "organization_id", {
      organization_id: organizationId, client_id: clientId, legal_name: business.legalName || business.displayName,
      display_name: business.displayName, vertical: business.vertical, tagline: business.tagline,
      description: business.description, website: business.website, primary_email: business.email,
      primary_phone: business.phone, status: "draft", updated_by: auth.context.userId, updated_at: now,
    });
    if (writeResponse.ok) {
      writeResponse = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`, {
        method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"),
        body: JSON.stringify({ name: business.displayName, industry: business.vertical, website: business.website, email: business.email, phone: business.phone }),
      });
    }
  } else if (step === "location") {
    const location = normalizeLocation(input.data);
    if (!location) return authJson({ error: "Add at least the primary city and a valid two-letter country code." }, 400);
    writeResponse = await upsert(url, serviceKey, "business_locations", "organization_id,location_key", {
      organization_id: organizationId, client_id: clientId, location_key: "primary", name: location.name,
      street_address: location.streetAddress, city: location.city, region: location.region,
      postal_code: location.postalCode, country_code: location.countryCode, service_area: location.serviceArea,
      is_primary: true, active: true, updated_at: now,
    });
    if (writeResponse.ok) {
      const legacyLocation = [location.streetAddress, location.city, location.region, location.postalCode].filter(Boolean).join(", ");
      writeResponse = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`, {
        method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ location: legacyLocation }),
      });
    }
  } else if (step === "services" && !skipped) {
    const services = normalizeServices(input.data);
    if (!services) return authJson({ error: "Add at least one uniquely named service, or skip this step for now." }, 400);
    const deleteResponse = await fetch(`${url}/rest/v1/business_services?organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") });
    if (!deleteResponse.ok) writeResponse = deleteResponse;
    else writeResponse = await fetch(`${url}/rest/v1/business_services`, {
      method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify(services.map((service, index) => ({ organization_id: organizationId, client_id: clientId, ...service, sort_order: index, active: true }))),
    });
  } else if (step === "goals" && !skipped) {
    const goals = normalizeGoals(input.data);
    if (!goals) return authJson({ error: "Add at least one business goal, or skip this step for now." }, 400);
    const deleteResponse = await fetch(`${url}/rest/v1/business_goals?organization_id=eq.${encodeURIComponent(organizationId)}&status=in.(draft,active)`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") });
    if (!deleteResponse.ok) writeResponse = deleteResponse;
    else writeResponse = await fetch(`${url}/rest/v1/business_goals`, {
      method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify(goals.map((goal, index) => ({ organization_id: organizationId, client_id: clientId, goal_type: goal.goalType, title: goal.title, target_value: goal.targetValue, target_unit: goal.targetUnit, target_date: goal.targetDate || null, status: "active", sort_order: index }))),
    });
  } else if (step !== "review") {
    writeResponse = new Response(null, { status: 204 });
  }
  if (writeResponse && !writeResponse.ok) return authJson({ error: "This onboarding step could not be saved." }, 502);

  const progressResponse = await fetch(`${url}/rest/v1/organization_onboarding?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&limit=1`, { headers: serviceHeaders(serviceKey) });
  const progressRows = progressResponse.ok ? await progressResponse.json().catch(() => []) as ProgressRow[] : [];
  if (!progressResponse.ok) return authJson({ error: "Onboarding progress storage is not ready." }, 503);
  const existing = progressRows[0] || {};
  const completed = new Set((existing.completed_steps || []).filter(isOnboardingStep));
  const skippedSteps = new Set((existing.skipped_steps || []).filter(isOnboardingStep));
  if (skipped) {
    skippedSteps.add(step);
    completed.delete(step);
  } else {
    completed.add(step);
    skippedSteps.delete(step);
  }
  const complete = step === "review" && input.complete === true;
  if (complete && !canCompleteOnboarding(Array.from(completed), Array.from(skippedSteps))) return authJson({ error: "Complete business and location details, then save or skip services and goals before finishing." }, 409);
  if (complete) completed.add("review");
  const completedSteps = orderedOnboardingSteps(Array.from(completed));
  const orderedSkippedSteps = orderedOnboardingSteps(Array.from(skippedSteps));
  const completionPercent = complete ? 100 : onboardingCompletion(completedSteps, orderedSkippedSteps);
  const nextStep = complete ? 5 : nextOnboardingStep(completedSteps, orderedSkippedSteps);
  const stepData = { ...(existing.step_data || {}), [step]: { saved_at: now, skipped }, last_saved_by: auth.context.userId };
  const saveProgressResponse = await upsert(url, serviceKey, "organization_onboarding", "organization_id", {
    organization_id: organizationId, client_id: clientId, status: complete ? "complete" : "in_progress",
    current_step: nextStep, completed_steps: completedSteps, skipped_steps: orderedSkippedSteps,
    completion_percent: completionPercent, step_data: stepData, started_at: existing.status === "not_started" || !existing.status ? now : undefined,
    completed_at: complete ? now : existing.completed_at || null, updated_by: auth.context.userId, updated_at: now,
  });
  if (!saveProgressResponse.ok) return authJson({ error: "The business data saved, but progress could not be updated." }, 502);

  await fetch(`${url}/rest/v1/audit_events`, {
    method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: organizationId, actor_user_id: auth.context.userId, action: complete ? "onboarding.completed" : "onboarding.step.saved", entity_type: "organization_onboarding", entity_id: organizationId, metadata: { client_id: clientId, step, skipped, completion_percent: completionPercent } }),
  });
  if (complete) {
    await Promise.all([
      fetch(`${url}/rest/v1/business_profiles?organization_id=eq.${encodeURIComponent(organizationId)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "active", updated_by: auth.context.userId, updated_at: now }) }),
      fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, event_type: "client.onboarding.completed", aggregate_type: "client", aggregate_id: clientId, payload: { client_id: clientId, completed_by: auth.context.userId } }) }),
    ]);
  }
  const snapshot = await readSnapshot(url, serviceKey, client);
  return authJson({ onboarding: snapshot, message: complete ? "Onboarding complete. The client workspace is ready." : skipped ? "Step skipped for now. Progress was saved." : "Progress saved." });
};
