import {
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "../../_shared/auth";
import { createNotification } from "../../_shared/notifications";

interface Env extends FunctionEnv {}

type ClientRow = { id: string; organization_id: string | null; name: string };
type LeadRow = { id: string; client_id: string; full_name: string; email: string; phone: string; company: string; service_interest: string; message: string; source: string; status: string; assigned_to: string | null; created_at: string; updated_at: string };
type AppointmentRow = { id: string; lead_id: string; title: string; starts_at: string; ends_at: string; timezone: string; status: string; location: string; notes: string; assigned_to: string | null; created_at: string };
type TaskRow = { id: string; lead_id: string | null; appointment_id: string | null; title: string; description: string; due_at: string | null; priority: string; status: string; assigned_to: string | null; completed_at: string | null; created_at: string };
type ActivityRow = { id: string; lead_id: string; activity_type: string; title: string; detail: string; created_at: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const leadStatuses = new Set(["new", "qualified", "contacted", "appointment_scheduled", "won", "lost"]);
const leadSources = new Set(["website", "referral", "phone", "email", "social", "other"]);
const appointmentStatuses = new Set(["scheduled", "completed", "canceled", "no_show"]);
const taskStatuses = new Set(["open", "in_progress", "completed", "canceled"]);
const taskPriorities = new Set(["low", "normal", "high", "urgent"]);

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

function validEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDateTime(value: unknown) {
  const candidate = clean(value, 80);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function resolveClient(url: string, serviceKey: string, context: AuthContext, requestedClientId: string) {
  const filter = requestedClientId
    ? `id=eq.${encodeURIComponent(requestedClientId)}`
    : context.clientId
      ? `id=eq.${encodeURIComponent(context.clientId)}`
      : "id=eq.00000000-0000-0000-0000-000000000000";
  const response = await fetch(`${url}/rest/v1/clients?${filter}&select=id,organization_id,name&limit=1`, { headers: serviceHeaders(serviceKey) });
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

function summary(leads: LeadRow[], tasks: TaskRow[], appointments: AppointmentRow[]) {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  return {
    activeLeads: leads.filter((lead) => !["won", "lost"].includes(lead.status)).length,
    unassigned: leads.filter((lead) => !lead.assigned_to && !["won", "lost"].includes(lead.status)).length,
    openTasks: tasks.filter((task) => !["completed", "canceled"].includes(task.status)).length,
    overdueTasks: tasks.filter((task) => task.due_at && task.due_at.slice(0, 10) < today && !["completed", "canceled"].includes(task.status)).length,
    upcomingAppointments: appointments.filter((appointment) => appointment.status === "scheduled" && appointment.starts_at >= nowIso).length,
    wonLeads: leads.filter((lead) => lead.status === "won").length,
  };
}

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, client: ClientRow) {
  const organizationId = client.organization_id || "";
  const [leadResponse, appointmentResponse, taskResponse, activityResponse, team] = await Promise.all([
    fetch(`${url}/rest/v1/crm_leads?client_id=eq.${encodeURIComponent(client.id)}&select=*&order=created_at.desc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_appointments?client_id=eq.${encodeURIComponent(client.id)}&select=*&order=starts_at.asc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_tasks?client_id=eq.${encodeURIComponent(client.id)}&select=*&order=due_at.asc.nullslast,created_at.desc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_activities?client_id=eq.${encodeURIComponent(client.id)}&select=id,lead_id,activity_type,title,detail,created_at&order=created_at.desc&limit=100`, { headers: serviceHeaders(serviceKey) }),
    readTeam(url, serviceKey, organizationId),
  ]);
  if (![leadResponse, appointmentResponse, taskResponse, activityResponse].every((response) => response.ok)) return null;
  const leads = await leadResponse.json().catch(() => []) as LeadRow[];
  const appointments = await appointmentResponse.json().catch(() => []) as AppointmentRow[];
  const tasks = await taskResponse.json().catch(() => []) as TaskRow[];
  const activities = await activityResponse.json().catch(() => []) as ActivityRow[];
  return {
    client: { id: client.id, name: client.name },
    canManage: hasOrganizationPermission(context, "crm.manage") && context.organizationRole !== "client",
    leads,
    appointments,
    tasks,
    activities,
    team,
    summary: summary(leads, tasks, appointments),
  };
}

async function writeLifecycle(url: string, serviceKey: string, input: { organizationId: string; userId: string; action: string; entityType: string; entityId: string; clientId: string; leadId?: string; metadata?: Record<string, unknown> }) {
  const metadata = { client_id: input.clientId, lead_id: input.leadId || null, ...(input.metadata || {}) };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, actor_user_id: input.userId, action: input.action, entity_type: input.entityType, entity_id: input.entityId, metadata }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, event_type: input.action, aggregate_type: input.entityType, aggregate_id: input.entityId, payload: metadata }) }),
  ]);
}

async function writeActivity(url: string, serviceKey: string, input: { organizationId: string; clientId: string; leadId: string; type: string; title: string; detail: string; userId: string; metadata?: Record<string, unknown> }) {
  const response = await fetch(`${url}/rest/v1/crm_activities`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, client_id: input.clientId, lead_id: input.leadId, activity_type: input.type, title: input.title, detail: input.detail, metadata: input.metadata || {}, created_by: input.userId }) });
  return response.ok;
}

async function authenticatedClient(request: Request, env: Env, requestedClientId: string) {
  const auth = await requireAuth(request, env, { permission: "crm.read" });
  if ("response" in auth) return auth;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: authJson({ error: "CRM storage is not configured." }, 500) };
  const client = await resolveClient(url, serviceKey, auth.context, requestedClientId);
  if (!client?.organization_id) return { response: authJson({ error: "Choose a client before opening CRM." }, 404) };
  const scoped = await requireAuth(request, env, { clientId: client.id, permission: "crm.read" });
  if ("response" in scoped) return scoped;
  return { context: scoped.context, client, url, serviceKey };
}

async function readLead(url: string, serviceKey: string, clientId: string, leadId: string) {
  if (!uuidPattern.test(leadId)) return null;
  const response = await fetch(`${url}/rest/v1/crm_leads?id=eq.${encodeURIComponent(leadId)}&client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as LeadRow[] : [];
  return rows[0] || null;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const requestedClientId = new URL(request.url).searchParams.get("client") || "";
  if (!uuidPattern.test(requestedClientId)) return authJson({ error: "Choose a valid client." }, 400);
  const resolved = await authenticatedClient(request, env, requestedClientId);
  if ("response" in resolved) return resolved.response;
  const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, resolved.client);
  if (!snapshot) return authJson({ error: "CRM storage is not ready. Apply supabase/crm.sql first." }, 503);
  return authJson({ snapshot });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = clean(input?.action, 60);
  const clientId = clean(input?.clientId, 36);
  if (!action || !uuidPattern.test(clientId)) return authJson({ error: "A valid CRM action and client are required." }, 400);
  const resolved = await authenticatedClient(request, env, clientId);
  if ("response" in resolved) return resolved.response;
  const { context, client, url, serviceKey } = resolved;
  if (!hasOrganizationPermission(context, "crm.manage") || context.organizationRole === "client") return authJson({ error: "Your role cannot change CRM records." }, 403);
  const organizationId = client.organization_id || "";
  const team = await readTeam(url, serviceKey, organizationId);
  const teamIds = new Set(team.map((member) => member.id));
  const now = new Date().toISOString();
  let entityId = "";
  let entityType = "crm_lead";
  let lifecycleAction = "";
  let leadId = clean(input?.leadId, 36);
  let notificationUserId = "";
  let notificationTitle = "";
  let notificationBody = "";

  if (action === "create_lead") {
    const fullName = clean(input?.fullName, 180);
    const email = clean(input?.email, 320).toLowerCase();
    const phone = clean(input?.phone, 60);
    const source = clean(input?.source, 30) || "website";
    const assignedTo = clean(input?.assignedTo, 36);
    if (!fullName || (!email && !phone) || !validEmail(email) || !leadSources.has(source) || (assignedTo && !teamIds.has(assignedTo))) return authJson({ error: "Enter a lead name, valid contact method, source, and assignee." }, 400);
    const response = await fetch(`${url}/rest/v1/crm_leads`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, full_name: fullName, email, phone, company: clean(input?.company, 180), service_interest: clean(input?.serviceInterest, 240), message: clean(input?.message, 4000), source, assigned_to: assignedTo || null, created_by: context.userId }) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
    entityId = rows[0]?.id || "";
    if (!response.ok || !uuidPattern.test(entityId)) return authJson({ error: "The lead could not be recorded." }, 502);
    leadId = entityId;
    lifecycleAction = "crm.lead.created";
    await writeActivity(url, serviceKey, { organizationId, clientId: client.id, leadId, type: "lead.created", title: "Lead captured", detail: `${fullName} entered the ${source} pipeline.`, userId: context.userId });
    if (assignedTo) { notificationUserId = assignedTo; notificationTitle = "New lead assigned"; notificationBody = `${fullName} is ready for first contact in ${client.name}.`; }
  } else if (action === "update_lead") {
    const lead = await readLead(url, serviceKey, client.id, leadId);
    const status = clean(input?.status, 40);
    const assignedTo = clean(input?.assignedTo, 36);
    if (!lead || !leadStatuses.has(status) || (assignedTo && !teamIds.has(assignedTo))) return authJson({ error: "Choose a valid lead, stage, and assignee." }, 400);
    const response = await fetch(`${url}/rest/v1/crm_leads?id=eq.${encodeURIComponent(lead.id)}&client_id=eq.${encodeURIComponent(client.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, assigned_to: assignedTo || null, converted_at: status === "won" ? now : null, updated_at: now }) });
    if (!response.ok) return authJson({ error: "The lead could not be updated." }, 502);
    entityId = lead.id;
    lifecycleAction = "crm.lead.updated";
    const assignmentChanged = (lead.assigned_to || "") !== assignedTo;
    await writeActivity(url, serviceKey, { organizationId, clientId: client.id, leadId, type: assignmentChanged ? "lead.assigned" : "lead.stage_changed", title: assignmentChanged ? "Assignment updated" : "Pipeline stage updated", detail: assignmentChanged ? `${lead.full_name} was assigned to a team member.` : `${lead.full_name} moved to ${status.replaceAll("_", " ")}.`, userId: context.userId, metadata: { status, assigned_to: assignedTo || null } });
    if (assignmentChanged && assignedTo) { notificationUserId = assignedTo; notificationTitle = "Lead assigned to you"; notificationBody = `${lead.full_name} needs follow-up for ${client.name}.`; }
  } else if (action === "schedule_appointment") {
    const lead = await readLead(url, serviceKey, client.id, leadId);
    const title = clean(input?.title, 180);
    const startsAt = validDateTime(input?.startsAt);
    const endsAt = validDateTime(input?.endsAt);
    const taskDueAt = validDateTime(input?.taskDueAt);
    const assignedTo = clean(input?.assignedTo, 36) || lead?.assigned_to || context.userId;
    const priority = clean(input?.priority, 20) || "normal";
    if (!lead || !title || !startsAt || !endsAt || startsAt === undefined || endsAt === undefined || taskDueAt === undefined || endsAt <= startsAt || !teamIds.has(assignedTo) || !taskPriorities.has(priority)) return authJson({ error: "Enter a valid appointment window, assignee, and follow-up due date." }, 400);
    const appointmentResponse = await fetch(`${url}/rest/v1/crm_appointments`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, lead_id: lead.id, title, starts_at: startsAt, ends_at: endsAt, timezone: clean(input?.timezone, 80) || "America/Los_Angeles", location: clean(input?.location, 500), notes: clean(input?.notes, 4000), assigned_to: assignedTo, created_by: context.userId }) });
    const appointments = appointmentResponse.ok ? await appointmentResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    const appointmentId = appointments[0]?.id || "";
    if (!appointmentResponse.ok || !uuidPattern.test(appointmentId)) return authJson({ error: "The appointment could not be scheduled." }, 502);
    const taskResponse = await fetch(`${url}/rest/v1/crm_tasks`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, lead_id: lead.id, appointment_id: appointmentId, title: clean(input?.taskTitle, 180) || `Follow up after ${title}`, description: clean(input?.taskDescription, 2000), due_at: taskDueAt, priority, assigned_to: assignedTo, created_by: context.userId }) });
    const tasks = taskResponse.ok ? await taskResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    const taskId = tasks[0]?.id || "";
    if (!taskResponse.ok || !uuidPattern.test(taskId)) {
      await fetch(`${url}/rest/v1/crm_appointments?id=eq.${encodeURIComponent(appointmentId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") });
      return authJson({ error: "The follow-up task could not be created, so the appointment was not kept." }, 502);
    }
    const leadResponse = await fetch(`${url}/rest/v1/crm_leads?id=eq.${encodeURIComponent(lead.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "appointment_scheduled", assigned_to: assignedTo, updated_at: now }) });
    if (!leadResponse.ok) {
      await Promise.allSettled([
        fetch(`${url}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(taskId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") }),
        fetch(`${url}/rest/v1/crm_appointments?id=eq.${encodeURIComponent(appointmentId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") }),
      ]);
      return authJson({ error: "The lead could not be moved into the appointment stage, so no partial schedule was kept." }, 502);
    }
    entityId = appointmentId;
    entityType = "crm_appointment";
    lifecycleAction = "crm.appointment.scheduled";
    await writeActivity(url, serviceKey, { organizationId, clientId: client.id, leadId, type: "appointment.scheduled", title: "Appointment scheduled", detail: `${title} is scheduled with a follow-up task.`, userId: context.userId, metadata: { appointment_id: appointmentId, task_id: taskId, starts_at: startsAt } });
    notificationUserId = assignedTo; notificationTitle = "Appointment scheduled"; notificationBody = `${title} with ${lead.full_name} is on your CRM calendar.`;
  } else if (action === "update_task") {
    const taskId = clean(input?.taskId, 36);
    const status = clean(input?.status, 30);
    if (!uuidPattern.test(taskId) || !taskStatuses.has(status)) return authJson({ error: "Choose a valid task and status." }, 400);
    const taskResponse = await fetch(`${url}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(taskId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id,lead_id,title&limit=1`, { headers: serviceHeaders(serviceKey) });
    const tasks = taskResponse.ok ? await taskResponse.json().catch(() => []) as Array<{ id?: string; lead_id?: string; title?: string }> : [];
    const task = tasks[0];
    if (!task?.id) return authJson({ error: "That task is unavailable." }, 404);
    const response = await fetch(`${url}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(task.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, completed_by: status === "completed" ? context.userId : null, completed_at: status === "completed" ? now : null, updated_at: now }) });
    if (!response.ok) return authJson({ error: "The task could not be updated." }, 502);
    entityId = task.id; entityType = "crm_task"; lifecycleAction = "crm.task.updated"; leadId = task.lead_id || "";
    if (leadId) await writeActivity(url, serviceKey, { organizationId, clientId: client.id, leadId, type: "task.updated", title: status === "completed" ? "Follow-up completed" : "Task status updated", detail: `${task.title || "Task"} is ${status.replaceAll("_", " ")}.`, userId: context.userId, metadata: { task_id: task.id, status } });
  } else if (action === "update_appointment") {
    const appointmentId = clean(input?.appointmentId, 36);
    const status = clean(input?.status, 30);
    if (!uuidPattern.test(appointmentId) || !appointmentStatuses.has(status)) return authJson({ error: "Choose a valid appointment and status." }, 400);
    const appointmentResponse = await fetch(`${url}/rest/v1/crm_appointments?id=eq.${encodeURIComponent(appointmentId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id,lead_id,title&limit=1`, { headers: serviceHeaders(serviceKey) });
    const appointments = appointmentResponse.ok ? await appointmentResponse.json().catch(() => []) as Array<{ id?: string; lead_id?: string; title?: string }> : [];
    const appointment = appointments[0];
    if (!appointment?.id || !appointment.lead_id) return authJson({ error: "That appointment is unavailable." }, 404);
    const response = await fetch(`${url}/rest/v1/crm_appointments?id=eq.${encodeURIComponent(appointment.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, updated_at: now }) });
    if (!response.ok) return authJson({ error: "The appointment could not be updated." }, 502);
    entityId = appointment.id; entityType = "crm_appointment"; lifecycleAction = "crm.appointment.updated"; leadId = appointment.lead_id;
    await writeActivity(url, serviceKey, { organizationId, clientId: client.id, leadId, type: "appointment.updated", title: "Appointment status updated", detail: `${appointment.title || "Appointment"} is ${status.replaceAll("_", " ")}.`, userId: context.userId, metadata: { appointment_id: appointment.id, status } });
  } else {
    return authJson({ error: "That CRM action is not supported." }, 400);
  }

  await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: lifecycleAction, entityType, entityId, clientId: client.id, leadId });
  if (notificationUserId) await createNotification(env, { userId: notificationUserId, clientId: client.id, type: "action", title: notificationTitle, body: notificationBody, href: `/crm/?client=${encodeURIComponent(client.id)}` });
  const snapshot = await readSnapshot(url, serviceKey, context, client);
  if (!snapshot) return authJson({ error: "The change saved, but the refreshed CRM view is unavailable." }, 502);
  return authJson({ snapshot, message: "CRM workflow updated." });
};
