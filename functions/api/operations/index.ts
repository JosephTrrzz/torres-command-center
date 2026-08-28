import {
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "../../_shared/auth";
import { emailConfigured, type EmailEnv } from "../../_shared/email";
import { createNotification } from "../../_shared/notifications";
import { estimateDecisionEmail, estimateReviewEmail, normalizeEmailRecipients, operationsSignInLink } from "../../_shared/operations-email";
import { activationEmailKey, sendTrackedEmail } from "../../_shared/tracked-email";

interface Env extends FunctionEnv, EmailEnv {
  PUBLIC_APP_URL?: string;
}

type ClientRow = { id: string; organization_id: string | null; name: string; industry: string; location: string; website: string; email: string };
type LocationRow = { id: string; name: string; street_address: string; city: string; region: string; postal_code: string; country_code: string; service_area: string; is_primary: boolean };
type ContactRow = { id: string; name: string; role: string; email: string; phone: string };
type LeadRow = { id: string; full_name: string; service_interest: string; status: string; converted_at: string | null; assigned_to?: string | null };
type ProjectRow = { id: string; name: string; status: string; progress_percent: number };
type JobRow = { id: string; lead_id: string | null; project_id: string | null; job_number: string; title: string; description: string; status: string; priority: string; scheduled_start: string | null; scheduled_end: string | null; location_id: string | null; assigned_to: string | null; client_visible: boolean; created_at: string; updated_at: string };
type ActivityRow = { id: string; job_id: string; activity_type: string; title: string; detail: string; client_visible: boolean; created_at: string };
type EstimateRow = { id: string; job_id: string; estimate_number: string; title: string; status: string; currency: string; subtotal: number | string; tax: number | string; total: number | string; expires_at: string | null; notes: string; client_visible: boolean; responded_at: string | null; created_at: string; created_by?: string | null };
type EstimateItemRow = { id: string; estimate_id: string; description: string; quantity: number | string; unit_price: number | string; amount: number | string; sort_order: number };
type DocumentRow = { id: string; job_id: string; estimate_id: string | null; title: string; description: string; document_type: string; status: string; resource_url: string; version: number; client_visible: boolean; created_at: string };
type TaskRow = { id: string; job_id: string | null; title: string; description: string; due_at: string | null; priority: string; status: string; assigned_to: string | null; completed_at: string | null; created_at: string };
type AppointmentRow = { id: string; title: string; starts_at: string; ends_at: string; status: string; assigned_to: string | null };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jobStatuses = new Set(["requested", "scheduled", "in_progress", "waiting", "completed", "canceled"]);
const jobPriorities = new Set(["low", "normal", "high", "urgent"]);
const estimateResponses = new Set(["accepted", "rejected"]);
const documentTypes = new Set(["proposal", "contract", "invoice", "report", "photo", "other"]);
const documentStatuses = new Set(["draft", "shared", "approved", "archived"]);
const taskStatuses = new Set(["open", "in_progress", "completed", "canceled"]);

function serviceHeaders(serviceKey: string, prefer?: string) {
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

function dateTime(value: unknown) {
  const candidate = clean(value, 80);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function dateOnly(value: unknown) {
  const candidate = clean(value, 10);
  return !candidate ? null : /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

function finiteNumber(value: unknown) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || `location-${crypto.randomUUID().slice(0, 8)}`;
}

function numberValue(value: number | string) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

async function resolveClient(url: string, serviceKey: string, context: AuthContext, requestedClientId: string) {
  const clientId = requestedClientId || context.clientId || "";
  if (!uuidPattern.test(clientId)) return null;
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,name,industry,location,website,email&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as ClientRow[] : [];
  return rows[0] || null;
}

async function readTeam(url: string, serviceKey: string, clientOrganizationId: string) {
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(clientOrganizationId)}&select=parent_organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const organizations = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as Array<{ parent_organization_id?: string }> : [];
  const agencyId = organizations[0]?.parent_organization_id || clientOrganizationId;
  const membershipResponse = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(agencyId)}&status=eq.active&role=neq.client&select=user_id,role`, { headers: serviceHeaders(serviceKey) });
  const memberships = membershipResponse.ok ? await membershipResponse.json().catch(() => []) as Array<{ user_id?: string; role?: string }> : [];
  const userIds = memberships.map((row) => row.user_id).filter((id): id is string => Boolean(id && uuidPattern.test(id)));
  if (!userIds.length) return [];
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=in.(${userIds.join(",")})&select=id,full_name,email&active=eq.true`, { headers: serviceHeaders(serviceKey) });
  const profiles = profileResponse.ok ? await profileResponse.json().catch(() => []) as Array<{ id?: string; full_name?: string; email?: string }> : [];
  return profiles.flatMap((profile) => {
    if (!profile.id) return [];
    const membership = memberships.find((row) => row.user_id === profile.id);
    return [{ id: profile.id, name: clean(profile.full_name, 160) || clean(profile.email, 320) || "Team member", email: clean(profile.email, 320), role: membership?.role || "member" }];
  });
}

async function clientMemberIds(url: string, serviceKey: string, organizationId: string) {
  const response = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active&role=eq.client&select=user_id`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ user_id?: string }> : [];
  return rows.map((row) => row.user_id).filter((id): id is string => Boolean(id && uuidPattern.test(id)));
}

async function clientEmailRecipients(url: string, serviceKey: string, client: ClientRow) {
  const memberIds = await clientMemberIds(url, serviceKey, client.organization_id || "");
  let memberEmails: string[] = [];
  if (memberIds.length) {
    const profileResponse = await fetch(`${url}/rest/v1/profiles?id=in.(${memberIds.join(",")})&active=eq.true&select=email`, { headers: serviceHeaders(serviceKey) });
    const profiles = profileResponse.ok ? await profileResponse.json().catch(() => []) as Array<{ email?: string }> : [];
    memberEmails = normalizeEmailRecipients(profiles.map((profile) => profile.email));
  }
  if (memberEmails.length) return memberEmails;

  const accountResponse = await fetch(`${url}/rest/v1/customer_accounts?client_id=eq.${encodeURIComponent(client.id)}&portal_enabled=eq.true&portal_status=eq.active&select=portal_email&limit=1`, { headers: serviceHeaders(serviceKey) });
  const accounts = accountResponse.ok ? await accountResponse.json().catch(() => []) as Array<{ portal_email?: string }> : [];
  const accountEmails = normalizeEmailRecipients(accounts.map((account) => account.portal_email));
  if (accountEmails.length) return accountEmails;

  const primary = normalizeEmailRecipients([client.email]);
  if (primary.length) return primary;

  const contactResponse = await fetch(`${url}/rest/v1/client_people?client_id=eq.${encodeURIComponent(client.id)}&email=not.is.null&select=email&order=created_at.asc&limit=1`, { headers: serviceHeaders(serviceKey) });
  const contacts = contactResponse.ok ? await contactResponse.json().catch(() => []) as Array<{ email?: string }> : [];
  return normalizeEmailRecipients(contacts.map((contact) => contact.email));
}

async function writeLifecycle(url: string, serviceKey: string, input: { organizationId: string; userId: string; action: string; entityType: string; entityId: string; clientId: string; jobId?: string; metadata?: Record<string, unknown> }) {
  const metadata = { client_id: input.clientId, job_id: input.jobId || null, ...(input.metadata || {}) };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, actor_user_id: input.userId, action: input.action, entity_type: input.entityType, entity_id: input.entityId, metadata }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, event_type: input.action, aggregate_type: input.entityType, aggregate_id: input.entityId, payload: metadata }) }),
  ]);
}

async function writeJobActivity(url: string, serviceKey: string, input: { organizationId: string; clientId: string; jobId: string; type: string; title: string; detail: string; clientVisible: boolean; userId: string; metadata?: Record<string, unknown> }) {
  return fetch(`${url}/rest/v1/job_activities`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: input.organizationId, client_id: input.clientId, job_id: input.jobId, activity_type: input.type, title: input.title, detail: input.detail, client_visible: input.clientVisible, metadata: input.metadata || {}, created_by: input.userId }),
  });
}

async function readJob(url: string, serviceKey: string, clientId: string, jobId: string) {
  if (!uuidPattern.test(jobId)) return null;
  const response = await fetch(`${url}/rest/v1/service_jobs?id=eq.${encodeURIComponent(jobId)}&client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as JobRow[] : [];
  return rows[0] || null;
}

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, client: ClientRow) {
  const organizationId = client.organization_id || "";
  const isClient = context.organizationRole === "client" || (!context.organizationRole && context.role === "customer");
  const visibility = isClient ? "&client_visible=eq.true" : "";
  const [contactResponse, locationResponse, leadResponse, projectResponse, jobResponse, appointmentResponse, taskResponse, team] = await Promise.all([
    fetch(`${url}/rest/v1/client_people?client_id=eq.${encodeURIComponent(client.id)}&select=id,name,role,email,phone&order=created_at.asc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/business_locations?client_id=eq.${encodeURIComponent(client.id)}&active=eq.true&select=id,name,street_address,city,region,postal_code,country_code,service_area,is_primary&order=is_primary.desc,name.asc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_leads?client_id=eq.${encodeURIComponent(client.id)}&status=eq.won&select=id,full_name,service_interest,status,converted_at,assigned_to&order=converted_at.desc.nullslast`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/client_projects?client_id=eq.${encodeURIComponent(client.id)}&select=id,name,status,progress_percent&order=updated_at.desc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/service_jobs?client_id=eq.${encodeURIComponent(client.id)}${visibility}&select=*&order=scheduled_start.asc.nullslast,updated_at.desc`, { headers: serviceHeaders(serviceKey) }),
    isClient ? Promise.resolve(new Response("[]", { status: 200 })) : fetch(`${url}/rest/v1/crm_appointments?client_id=eq.${encodeURIComponent(client.id)}&select=id,title,starts_at,ends_at,status,assigned_to&order=starts_at.asc`, { headers: serviceHeaders(serviceKey) }),
    isClient ? Promise.resolve(new Response("[]", { status: 200 })) : fetch(`${url}/rest/v1/crm_tasks?client_id=eq.${encodeURIComponent(client.id)}&select=id,job_id,title,description,due_at,priority,status,assigned_to,completed_at,created_at&order=due_at.asc.nullslast,created_at.desc`, { headers: serviceHeaders(serviceKey) }),
    readTeam(url, serviceKey, organizationId),
  ]);
  if (![contactResponse, locationResponse, leadResponse, projectResponse, jobResponse, appointmentResponse, taskResponse].every((response) => response.ok)) return null;

  const contacts = await contactResponse.json().catch(() => []) as ContactRow[];
  const locations = await locationResponse.json().catch(() => []) as LocationRow[];
  const leads = await leadResponse.json().catch(() => []) as LeadRow[];
  const projects = await projectResponse.json().catch(() => []) as ProjectRow[];
  const jobs = await jobResponse.json().catch(() => []) as JobRow[];
  const appointments = await appointmentResponse.json().catch(() => []) as AppointmentRow[];
  const tasks = await taskResponse.json().catch(() => []) as TaskRow[];
  const jobIds = jobs.map((job) => job.id);
  let activities: ActivityRow[] = [];
  let estimates: EstimateRow[] = [];
  let documents: DocumentRow[] = [];
  if (jobIds.length) {
    const inFilter = jobIds.join(",");
    const [activityResponse, estimateResponse, documentResponse] = await Promise.all([
      fetch(`${url}/rest/v1/job_activities?job_id=in.(${inFilter})${visibility}&select=id,job_id,activity_type,title,detail,client_visible,created_at&order=created_at.desc`, { headers: serviceHeaders(serviceKey) }),
      fetch(`${url}/rest/v1/job_estimates?job_id=in.(${inFilter})${visibility}&select=*&order=created_at.desc`, { headers: serviceHeaders(serviceKey) }),
      fetch(`${url}/rest/v1/job_documents?job_id=in.(${inFilter})${visibility}&select=*&order=created_at.desc`, { headers: serviceHeaders(serviceKey) }),
    ]);
    if (![activityResponse, estimateResponse, documentResponse].every((response) => response.ok)) return null;
    activities = await activityResponse.json().catch(() => []) as ActivityRow[];
    estimates = await estimateResponse.json().catch(() => []) as EstimateRow[];
    documents = await documentResponse.json().catch(() => []) as DocumentRow[];
  }
  let items: EstimateItemRow[] = [];
  if (estimates.length) {
    const itemResponse = await fetch(`${url}/rest/v1/job_estimate_items?estimate_id=in.(${estimates.map((estimate) => estimate.id).join(",")})&select=*&order=sort_order.asc`, { headers: serviceHeaders(serviceKey) });
    if (!itemResponse.ok) return null;
    items = await itemResponse.json().catch(() => []) as EstimateItemRow[];
  }

  const normalizedEstimates = estimates.map((estimate) => ({
    ...estimate,
    subtotal: numberValue(estimate.subtotal),
    tax: numberValue(estimate.tax),
    total: numberValue(estimate.total),
    items: items.filter((item) => item.estimate_id === estimate.id).map((item) => ({ ...item, quantity: numberValue(item.quantity), unit_price: numberValue(item.unit_price), amount: numberValue(item.amount) })),
  }));
  const normalizedJobs = jobs.map((job) => ({
    ...job,
    activities: activities.filter((activity) => activity.job_id === job.id),
    estimates: normalizedEstimates.filter((estimate) => estimate.job_id === job.id),
    documents: documents.filter((document) => document.job_id === job.id),
    tasks: tasks.filter((task) => task.job_id === job.id),
  }));
  const activeJobs = normalizedJobs.filter((job) => !["completed", "canceled"].includes(job.status));
  const calendar = [
    ...normalizedJobs.filter((job) => job.scheduled_start).map((job) => ({ id: job.id, kind: "job", title: job.title, starts_at: job.scheduled_start as string, ends_at: job.scheduled_end, status: job.status, assigned_to: job.assigned_to, job_id: job.id })),
    ...appointments.map((appointment) => ({ id: appointment.id, kind: "appointment", title: appointment.title, starts_at: appointment.starts_at, ends_at: appointment.ends_at, status: appointment.status, assigned_to: appointment.assigned_to, job_id: null })),
    ...tasks.filter((task) => task.due_at).map((task) => ({ id: task.id, kind: "task", title: task.title, starts_at: task.due_at as string, ends_at: null, status: task.status, assigned_to: task.assigned_to, job_id: task.job_id })),
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const canManage = hasOrganizationPermission(context, "operations.manage") && !isClient;
  return {
    client: { id: client.id, name: client.name, industry: client.industry || "", location: client.location || "", website: client.website || "" },
    canManage,
    canRespondToEstimates: isClient,
    contacts,
    locations: locations.map((location) => ({ id: location.id, label: location.name, address_line_1: location.street_address, address_line_2: "", city: location.city, region: location.region, postal_code: location.postal_code, country: location.country_code, is_primary: location.is_primary, access_notes: location.service_area })),
    leads,
    projects,
    jobs: normalizedJobs,
    calendar,
    team,
    summary: {
      activeJobs: activeJobs.length,
      urgentJobs: activeJobs.filter((job) => job.priority === "urgent").length,
      upcomingJobs: activeJobs.filter((job) => job.scheduled_start && job.scheduled_start >= new Date().toISOString()).length,
      pendingEstimates: normalizedEstimates.filter((estimate) => estimate.status === "sent").length,
      acceptedValue: normalizedEstimates.filter((estimate) => estimate.status === "accepted").reduce((sum, estimate) => sum + estimate.total, 0),
      sharedDocuments: documents.filter((document) => document.client_visible).length,
    },
  };
}

async function authenticatedClient(request: Request, env: Env, requestedClientId: string) {
  const auth = await requireAuth(request, env, { permission: "operations.read" });
  if ("response" in auth) return auth;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: authJson({ error: "Operations storage is not configured." }, 500) };
  const client = await resolveClient(url, serviceKey, auth.context, requestedClientId);
  if (!client?.organization_id) return { response: authJson({ error: "Choose a client before opening operations." }, 404) };
  const scoped = await requireAuth(request, env, { clientId: client.id, permission: "operations.read" });
  if ("response" in scoped) return scoped;
  return { context: scoped.context, client, url, serviceKey };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const requestedClientId = new URL(request.url).searchParams.get("client") || "";
  if (requestedClientId && !uuidPattern.test(requestedClientId)) return authJson({ error: "Choose a valid client." }, 400);
  const resolved = await authenticatedClient(request, env, requestedClientId);
  if ("response" in resolved) return resolved.response;
  const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, resolved.client);
  if (!snapshot) return authJson({ error: "Operations storage is not ready. Apply supabase/operations.sql first." }, 503);
  return authJson({ snapshot });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = clean(input?.action, 60);
  const clientId = clean(input?.clientId, 36);
  if (!action || !uuidPattern.test(clientId)) return authJson({ error: "A valid operations action and client are required." }, 400);
  const resolved = await authenticatedClient(request, env, clientId);
  if ("response" in resolved) return resolved.response;
  const { context, client, url, serviceKey } = resolved;
  const organizationId = client.organization_id || "";
  const canManage = hasOrganizationPermission(context, "operations.manage") && context.organizationRole !== "client" && context.role !== "customer";
  const now = new Date().toISOString();
  let entityId = "";
  let entityType = "service_job";
  let lifecycleAction = "";
  let lifecycleJobId = "";
  let successMessage = "Operations workspace updated.";

  if (action === "respond_estimate") {
    const estimateId = clean(input?.estimateId, 36);
    const responseStatus = clean(input?.response, 20);
    if (!uuidPattern.test(estimateId) || !estimateResponses.has(responseStatus)) return authJson({ error: "Choose an estimate and an accepted or rejected response." }, 400);
    if (!(context.organizationRole === "client" || context.role === "customer")) return authJson({ error: "Only an authorized client member can respond to this estimate." }, 403);
    const estimateResponse = await fetch(`${url}/rest/v1/job_estimates?id=eq.${encodeURIComponent(estimateId)}&client_id=eq.${encodeURIComponent(client.id)}&client_visible=eq.true&status=eq.sent&select=id,job_id,title,estimate_number,total,currency,created_by&limit=1`, { headers: serviceHeaders(serviceKey) });
    const estimates = estimateResponse.ok ? await estimateResponse.json().catch(() => []) as Array<{ id?: string; job_id?: string; title?: string; estimate_number?: string; total?: string | number; currency?: string; created_by?: string | null }> : [];
    const estimate = estimates[0];
    if (!estimate?.id || !estimate.job_id) return authJson({ error: "That estimate is no longer awaiting a response." }, 404);
    const updateResponse = await fetch(`${url}/rest/v1/job_estimates?id=eq.${encodeURIComponent(estimate.id)}&status=eq.sent`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ status: responseStatus, responded_by: context.userId, responded_at: now, updated_at: now }) });
    if (!updateResponse.ok) return authJson({ error: "Your estimate response could not be saved." }, 502);
    const updatedEstimates = await updateResponse.json().catch(() => []) as Array<{ id?: string }>;
    if (!updatedEstimates[0]?.id) return authJson({ error: "That estimate is no longer awaiting a response." }, 409);
    await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: estimate.job_id, type: "estimate.responded", title: `Estimate ${responseStatus}`, detail: `${estimate.title || "Estimate"} was ${responseStatus} by the client.`, clientVisible: true, userId: context.userId, metadata: { estimate_id: estimate.id, status: responseStatus } });
    entityId = estimate.id; entityType = "job_estimate"; lifecycleAction = `operations.estimate.${responseStatus}`; lifecycleJobId = estimate.job_id;
    const job = await readJob(url, serviceKey, client.id, estimate.job_id);
    if (job?.assigned_to) await createNotification(env, { userId: job.assigned_to, clientId: client.id, type: "action", title: `Estimate ${responseStatus}`, body: `${client.name} ${responseStatus} ${estimate.title || "an estimate"}.`, href: `/operations/?client=${encodeURIComponent(client.id)}&job=${encodeURIComponent(estimate.job_id)}` });
    const team = await readTeam(url, serviceKey, organizationId);
    const directIds = new Set([job?.assigned_to, estimate.created_by].filter((id): id is string => Boolean(id)));
    const directRecipients = normalizeEmailRecipients(team.filter((member) => directIds.has(member.id)).map((member) => member.email));
    const fallbackRecipients = normalizeEmailRecipients(team.filter((member) => ["owner", "admin"].includes(member.role)).map((member) => member.email));
    const staffRecipients = directRecipients.length ? directRecipients : fallbackRecipients.length ? fallbackRecipients : normalizeEmailRecipients(team.map((member) => member.email).slice(0, 1));
    if (!staffRecipients.length) {
      successMessage = `Estimate ${responseStatus}. The response was saved; no staff email recipient is configured.`;
    } else if (!emailConfigured(env)) {
      successMessage = `Estimate ${responseStatus}. The response was saved, but team email is not configured.`;
    } else {
      const actionUrl = operationsSignInLink(request.url, env.PUBLIC_APP_URL, { clientId: client.id, jobId: estimate.job_id });
      const content = estimateDecisionEmail({ clientName: client.name, estimateNumber: estimate.estimate_number, estimateTitle: estimate.title, response: responseStatus as "accepted" | "rejected", responder: context.email || "an authorized client member", actionUrl });
      const deliveries = await Promise.all(staffRecipients.map(async (recipient) => sendTrackedEmail(env, {
        supabaseUrl: url,
        serviceKey,
        organizationId,
        clientId: client.id,
        recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
        templateKey: "estimate_decision",
        idempotencyKey: await activationEmailKey(`estimate-decision:${estimate.id}:${responseStatus}`, recipient),
      })));
      const sentCount = deliveries.filter((delivery) => delivery.sent).length;
      successMessage = sentCount
        ? `Estimate ${responseStatus}. The operations team was notified.`
        : `Estimate ${responseStatus}. The response was saved, but the team email could not be sent.`;
    }
  } else {
    if (!canManage) return authJson({ error: "Your role cannot change operational records." }, 403);
    const team = await readTeam(url, serviceKey, organizationId);
    const teamIds = new Set(team.map((member) => member.id));

    if (action === "create_location") {
      const label = clean(input?.label, 160);
      const country = clean(input?.country, 2).toUpperCase() || "US";
      const isPrimary = input?.isPrimary === true;
      if (!label || !/^[A-Z]{2}$/.test(country)) return authJson({ error: "Enter a location name and two-letter country code." }, 400);
      if (isPrimary) await fetch(`${url}/rest/v1/business_locations?client_id=eq.${encodeURIComponent(client.id)}&is_primary=eq.true`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ is_primary: false, updated_at: now }) });
      const response = await fetch(`${url}/rest/v1/business_locations`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, location_key: `${slug(label)}-${crypto.randomUUID().slice(0, 6)}`, name: label, street_address: clean(input?.addressLine1, 300), city: clean(input?.city, 120), region: clean(input?.region, 120), postal_code: clean(input?.postalCode, 30), country_code: country, service_area: clean(input?.accessNotes, 1000), is_primary: isPrimary, active: true }) });
      const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
      entityId = rows[0]?.id || "";
      if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The customer location could not be saved." }, 502);
      entityType = "business_location"; lifecycleAction = "operations.location.created";
    } else if (action === "create_job") {
      const leadId = clean(input?.leadId, 36);
      const projectId = clean(input?.projectId, 36);
      const assignedTo = clean(input?.assignedTo, 36);
      const priority = clean(input?.priority, 20) || "normal";
      const scheduledStart = dateTime(input?.scheduledStart);
      const scheduledEnd = dateTime(input?.scheduledEnd);
      const locationId = clean(input?.locationId, 36);
      let title = clean(input?.title, 180);
      let description = clean(input?.description, 4000);
      let lead: LeadRow | null = null;
      if (leadId) {
        if (!uuidPattern.test(leadId)) return authJson({ error: "Choose a valid won lead." }, 400);
        const leadResponse = await fetch(`${url}/rest/v1/crm_leads?id=eq.${encodeURIComponent(leadId)}&client_id=eq.${encodeURIComponent(client.id)}&status=eq.won&select=id,full_name,service_interest,status,converted_at,assigned_to&limit=1`, { headers: serviceHeaders(serviceKey) });
        const leads = leadResponse.ok ? await leadResponse.json().catch(() => []) as LeadRow[] : [];
        lead = leads[0] || null;
        if (!lead) return authJson({ error: "Only a won lead can be converted into a service job." }, 400);
        title ||= lead.service_interest || `Service for ${lead.full_name}`;
        description ||= `Converted from the won lead for ${lead.full_name}.`;
      }
      if (!title || !jobPriorities.has(priority) || scheduledStart === undefined || scheduledEnd === undefined || (scheduledStart && scheduledEnd && scheduledEnd <= scheduledStart) || (assignedTo && !teamIds.has(assignedTo)) || (projectId && !uuidPattern.test(projectId)) || (locationId && !uuidPattern.test(locationId))) return authJson({ error: "Enter a job title, valid priority, schedule, location, project, and assignee." }, 400);
      if (projectId) {
        const projectResponse = await fetch(`${url}/rest/v1/client_projects?id=eq.${encodeURIComponent(projectId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
        const projects = projectResponse.ok ? await projectResponse.json().catch(() => []) as Array<{ id?: string }> : [];
        if (!projects[0]?.id) return authJson({ error: "That project does not belong to this client." }, 400);
      }
      const response = await fetch(`${url}/rest/v1/service_jobs`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, lead_id: lead?.id || null, project_id: projectId || null, job_number: `JOB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, title, description, status: scheduledStart ? "scheduled" : "requested", priority, scheduled_start: scheduledStart, scheduled_end: scheduledEnd, location_id: locationId || null, assigned_to: assignedTo || lead?.assigned_to || null, client_visible: input?.clientVisible !== false, created_by: context.userId }) });
      const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
      entityId = rows[0]?.id || "";
      if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: lead ? "That lead may already have a service job." : "The service job could not be created." }, 502);
      lifecycleJobId = entityId; lifecycleAction = "operations.job.created";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: entityId, type: "job.created", title: "Service job created", detail: `${title} entered operations${scheduledStart ? " with a scheduled start" : ""}.`, clientVisible: input?.clientVisible !== false, userId: context.userId });
    } else if (action === "update_job") {
      const jobId = clean(input?.jobId, 36);
      const job = await readJob(url, serviceKey, client.id, jobId);
      const status = clean(input?.status, 30);
      const priority = clean(input?.priority, 20);
      const assignedTo = clean(input?.assignedTo, 36);
      const locationId = clean(input?.locationId, 36);
      const scheduledStart = dateTime(input?.scheduledStart);
      const scheduledEnd = dateTime(input?.scheduledEnd);
      if (!job || !jobStatuses.has(status) || !jobPriorities.has(priority) || scheduledStart === undefined || scheduledEnd === undefined || (scheduledStart && scheduledEnd && scheduledEnd <= scheduledStart) || (assignedTo && !teamIds.has(assignedTo)) || (locationId && !uuidPattern.test(locationId))) return authJson({ error: "Choose a valid job, status, priority, schedule, location, and assignee." }, 400);
      const response = await fetch(`${url}/rest/v1/service_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, priority, scheduled_start: scheduledStart, scheduled_end: scheduledEnd, location_id: locationId || null, assigned_to: assignedTo || null, client_visible: input?.clientVisible !== false, completed_at: status === "completed" ? now : null, updated_at: now }) });
      if (!response.ok) return authJson({ error: "The job could not be updated." }, 502);
      entityId = job.id; lifecycleJobId = job.id; lifecycleAction = "operations.job.updated";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: job.id, type: "job.updated", title: "Job plan updated", detail: `${job.title} is now ${status.replaceAll("_", " ")} with ${priority} priority.`, clientVisible: input?.clientVisible !== false, userId: context.userId, metadata: { status, priority, assigned_to: assignedTo || null } });
    } else if (action === "add_job_note") {
      const jobId = clean(input?.jobId, 36);
      const job = await readJob(url, serviceKey, client.id, jobId);
      const detail = clean(input?.detail, 4000);
      if (!job || !detail) return authJson({ error: "Choose a job and enter a note." }, 400);
      const response = await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: job.id, type: "job.note", title: clean(input?.title, 180) || "Job note", detail, clientVisible: input?.clientVisible === true, userId: context.userId });
      if (!response.ok) return authJson({ error: "The job note could not be saved." }, 502);
      entityId = job.id; lifecycleJobId = job.id; lifecycleAction = "operations.job.note_added";
    } else if (action === "create_job_task") {
      const jobId = clean(input?.jobId, 36);
      const job = await readJob(url, serviceKey, client.id, jobId);
      const title = clean(input?.title, 180);
      const dueAt = dateTime(input?.dueAt);
      const priority = clean(input?.priority, 20) || "normal";
      const assignedTo = clean(input?.assignedTo, 36);
      if (!job || !title || dueAt === undefined || !jobPriorities.has(priority) || (assignedTo && !teamIds.has(assignedTo))) return authJson({ error: "Enter a job task, valid due date, priority, and assignee." }, 400);
      const response = await fetch(`${url}/rest/v1/crm_tasks`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, job_id: job.id, title, description: clean(input?.description, 2000), due_at: dueAt, priority, assigned_to: assignedTo || job.assigned_to || null, created_by: context.userId }) });
      const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
      entityId = rows[0]?.id || "";
      if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The job task could not be created." }, 502);
      entityType = "crm_task"; lifecycleJobId = job.id; lifecycleAction = "operations.task.created";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: job.id, type: "task.created", title: "Job task created", detail: title, clientVisible: false, userId: context.userId, metadata: { task_id: entityId } });
    } else if (action === "update_job_task") {
      const taskId = clean(input?.taskId, 36);
      const status = clean(input?.status, 30);
      if (!uuidPattern.test(taskId) || !taskStatuses.has(status)) return authJson({ error: "Choose a valid task and status." }, 400);
      const taskResponse = await fetch(`${url}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(taskId)}&client_id=eq.${encodeURIComponent(client.id)}&job_id=not.is.null&select=id,job_id,title&limit=1`, { headers: serviceHeaders(serviceKey) });
      const tasks = taskResponse.ok ? await taskResponse.json().catch(() => []) as Array<{ id?: string; job_id?: string; title?: string }> : [];
      const task = tasks[0];
      if (!task?.id || !task.job_id) return authJson({ error: "That job task is unavailable." }, 404);
      const response = await fetch(`${url}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(task.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, completed_by: status === "completed" ? context.userId : null, completed_at: status === "completed" ? now : null, updated_at: now }) });
      if (!response.ok) return authJson({ error: "The job task could not be updated." }, 502);
      entityId = task.id; entityType = "crm_task"; lifecycleJobId = task.job_id; lifecycleAction = "operations.task.updated";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: task.job_id, type: "task.updated", title: "Job task updated", detail: `${task.title || "Task"} is ${status.replaceAll("_", " ")}.`, clientVisible: false, userId: context.userId, metadata: { task_id: task.id, status } });
    } else if (action === "create_estimate") {
      const jobId = clean(input?.jobId, 36);
      const job = await readJob(url, serviceKey, client.id, jobId);
      const title = clean(input?.title, 180);
      const expiresAt = dateOnly(input?.expiresAt);
      const taxRate = finiteNumber(input?.taxRate);
      const rawItems = Array.isArray(input?.items) ? input.items.slice(0, 30) as Array<Record<string, unknown>> : [];
      const items = rawItems.map((item, index) => ({ description: clean(item.description, 500), quantity: finiteNumber(item.quantity), unitPrice: finiteNumber(item.unitPrice), sortOrder: index }));
      if (!job || !title || expiresAt === undefined || taxRate === undefined || taxRate < 0 || taxRate > 1 || !items.length || items.some((item) => !item.description || item.quantity === undefined || item.quantity <= 0 || item.unitPrice === undefined || item.unitPrice < 0)) return authJson({ error: "Enter a valid estimate title, expiration, tax rate, and at least one line item." }, 400);
      const subtotal = Math.round(items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0) * 100) / 100;
      const tax = Math.round(subtotal * taxRate * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const response = await fetch(`${url}/rest/v1/job_estimates`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, job_id: job.id, estimate_number: `EST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, title, status: "draft", currency: "USD", subtotal, tax, total, expires_at: expiresAt, notes: clean(input?.notes, 3000), client_visible: false, created_by: context.userId }) });
      const estimates = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
      const estimateId = estimates[0]?.id || "";
      if (!response.ok || !uuidPattern.test(estimateId)) return authJson({ error: "The estimate could not be created." }, 502);
      const itemResponse = await fetch(`${url}/rest/v1/job_estimate_items`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify(items.map((item) => ({ organization_id: organizationId, estimate_id: estimateId, description: item.description, quantity: item.quantity, unit_price: item.unitPrice, amount: Math.round((item.quantity || 0) * (item.unitPrice || 0) * 100) / 100, sort_order: item.sortOrder }))) });
      if (!itemResponse.ok) {
        await fetch(`${url}/rest/v1/job_estimates?id=eq.${encodeURIComponent(estimateId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") });
        return authJson({ error: "The estimate line items could not be saved, so no partial estimate was kept." }, 502);
      }
      entityId = estimateId; entityType = "job_estimate"; lifecycleJobId = job.id; lifecycleAction = "operations.estimate.created";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: job.id, type: "estimate.created", title: "Estimate drafted", detail: `${title} totals ${total.toFixed(2)} USD.`, clientVisible: false, userId: context.userId, metadata: { estimate_id: estimateId, total } });
    } else if (action === "send_estimate") {
      const estimateId = clean(input?.estimateId, 36);
      if (!uuidPattern.test(estimateId)) return authJson({ error: "Choose an estimate to send." }, 400);
      if (!emailConfigured(env)) return authJson({ error: "Transactional email is not configured. Add the Resend API key and verified sender before sending estimates." }, 503);
      const estimateResponse = await fetch(`${url}/rest/v1/job_estimates?id=eq.${encodeURIComponent(estimateId)}&client_id=eq.${encodeURIComponent(client.id)}&status=eq.draft&select=id,job_id,title,estimate_number,total,currency,expires_at,created_by&limit=1`, { headers: serviceHeaders(serviceKey) });
      const estimates = estimateResponse.ok ? await estimateResponse.json().catch(() => []) as Array<{ id?: string; job_id?: string; title?: string; estimate_number?: string; total?: string | number; currency?: string; expires_at?: string | null; created_by?: string | null }> : [];
      const estimate = estimates[0];
      if (!estimate?.id || !estimate.job_id) return authJson({ error: "Only a draft estimate can be sent." }, 400);
      const recipients = await clientEmailRecipients(url, serviceKey, client);
      if (!recipients.length) return authJson({ error: "Add an active client portal email or client contact email before sending this estimate." }, 400);
      const actionUrl = operationsSignInLink(request.url, env.PUBLIC_APP_URL, { clientId: client.id, jobId: estimate.job_id });
      const content = estimateReviewEmail({ clientName: client.name, estimateNumber: estimate.estimate_number, estimateTitle: estimate.title, total: estimate.total, currency: estimate.currency, expiresAt: estimate.expires_at, actionUrl });
      const response = await fetch(`${url}/rest/v1/job_estimates?id=eq.${encodeURIComponent(estimate.id)}&status=eq.draft`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ status: "sent", client_visible: true, updated_at: now }) });
      if (!response.ok) return authJson({ error: "The estimate could not be sent." }, 502);
      const updatedEstimates = await response.json().catch(() => []) as Array<{ id?: string }>;
      if (!updatedEstimates[0]?.id) return authJson({ error: "That estimate was already sent or changed. Refresh Operations before trying again." }, 409);
      const deliveries = await Promise.all(recipients.map(async (recipient) => sendTrackedEmail(env, {
        supabaseUrl: url,
        serviceKey,
        organizationId,
        clientId: client.id,
        recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
        templateKey: "estimate_review",
        idempotencyKey: await activationEmailKey(`estimate-review:${estimate.id}`, recipient),
      })));
      const sentCount = deliveries.filter((delivery) => delivery.sent).length;
      const failedCount = deliveries.length - sentCount;
      if (!sentCount) {
        await fetch(`${url}/rest/v1/job_estimates?id=eq.${encodeURIComponent(estimate.id)}&status=eq.sent`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "draft", client_visible: false, updated_at: new Date().toISOString() }) });
        const detail = deliveries.find((delivery) => delivery.error)?.error || "The email provider did not accept the message.";
        return authJson({ error: `The estimate email could not be sent, so it remains a draft. ${detail}` }, 502);
      }
      entityId = estimate.id; entityType = "job_estimate"; lifecycleJobId = estimate.job_id; lifecycleAction = "operations.estimate.sent";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: estimate.job_id, type: "estimate.sent", title: "Estimate sent", detail: `${estimate.title || "Estimate"} is ready for client review.`, clientVisible: true, userId: context.userId, metadata: { estimate_id: estimate.id } });
      const members = await clientMemberIds(url, serviceKey, organizationId);
      await Promise.allSettled(members.map((userId) => createNotification(env, { userId, clientId: client.id, type: "action", title: "Estimate ready for review", body: `${estimate.title || "A new estimate"} is ready in your client workspace.`, href: `/operations/?job=${encodeURIComponent(estimate.job_id || "")}` })));
      successMessage = `Estimate sent securely to ${sentCount} recipient${sentCount === 1 ? "" : "s"}.${failedCount ? ` ${failedCount} additional delivery${failedCount === 1 ? "" : "ies"} could not be sent.` : ""}`;
    } else if (action === "add_document") {
      const jobId = clean(input?.jobId, 36);
      const job = await readJob(url, serviceKey, client.id, jobId);
      const title = clean(input?.title, 180);
      const resourceUrl = clean(input?.resourceUrl, 2000);
      const documentType = clean(input?.documentType, 30) || "other";
      const clientVisible = input?.clientVisible === true;
      let parsedUrl: URL | null = null;
      try { parsedUrl = new URL(resourceUrl); } catch { parsedUrl = null; }
      if (!job || !title || !parsedUrl || parsedUrl.protocol !== "https:" || !documentTypes.has(documentType)) return authJson({ error: "Choose a job and enter a title, HTTPS document link, and document type." }, 400);
      const response = await fetch(`${url}/rest/v1/job_documents`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, job_id: job.id, title, description: clean(input?.description, 2000), document_type: documentType, status: clientVisible ? "shared" : "draft", resource_url: resourceUrl, version: 1, client_visible: clientVisible, created_by: context.userId }) });
      const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
      entityId = rows[0]?.id || "";
      if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The document link could not be saved." }, 502);
      entityType = "job_document"; lifecycleJobId = job.id; lifecycleAction = "operations.document.created";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: job.id, type: "document.created", title: clientVisible ? "Document shared" : "Document added", detail: title, clientVisible, userId: context.userId, metadata: { document_id: entityId, document_type: documentType } });
      if (clientVisible) {
        const members = await clientMemberIds(url, serviceKey, organizationId);
        await Promise.allSettled(members.map((userId) => createNotification(env, { userId, clientId: client.id, type: "action", title: "New document available", body: `${title} is ready to preview in your workspace.`, href: `/operations/?job=${encodeURIComponent(job.id)}` })));
      }
    } else if (action === "update_document") {
      const documentId = clean(input?.documentId, 36);
      const status = clean(input?.status, 30);
      if (!uuidPattern.test(documentId) || !documentStatuses.has(status)) return authJson({ error: "Choose a valid document and status." }, 400);
      const documentResponse = await fetch(`${url}/rest/v1/job_documents?id=eq.${encodeURIComponent(documentId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id,job_id,title&limit=1`, { headers: serviceHeaders(serviceKey) });
      const documents = documentResponse.ok ? await documentResponse.json().catch(() => []) as Array<{ id?: string; job_id?: string; title?: string }> : [];
      const document = documents[0];
      if (!document?.id || !document.job_id) return authJson({ error: "That document is unavailable." }, 404);
      const clientVisible = input?.clientVisible === true;
      const response = await fetch(`${url}/rest/v1/job_documents?id=eq.${encodeURIComponent(document.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, client_visible: clientVisible, updated_at: now }) });
      if (!response.ok) return authJson({ error: "The document could not be updated." }, 502);
      entityId = document.id; entityType = "job_document"; lifecycleJobId = document.job_id; lifecycleAction = "operations.document.updated";
      await writeJobActivity(url, serviceKey, { organizationId, clientId: client.id, jobId: document.job_id, type: "document.updated", title: "Document updated", detail: `${document.title || "Document"} is ${status}.`, clientVisible, userId: context.userId, metadata: { document_id: document.id, status } });
    } else {
      return authJson({ error: "That operations action is not supported." }, 400);
    }
  }

  await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: lifecycleAction, entityType, entityId, clientId: client.id, jobId: lifecycleJobId || undefined });
  const snapshot = await readSnapshot(url, serviceKey, context, client);
  if (!snapshot) return authJson({ error: "The change saved, but the refreshed operations view is unavailable." }, 502);
  return authJson({ snapshot, message: successMessage });
};
