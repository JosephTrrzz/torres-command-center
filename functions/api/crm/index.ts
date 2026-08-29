import {
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "../../_shared/auth";
import { createNotification } from "../../_shared/notifications";
import { crmConversationId } from "../../_shared/crm-chat";

interface Env extends FunctionEnv {}

type ClientRow = { id: string; organization_id: string | null; name: string };
type OrganizationRow = { id: string };
type LeadRow = { id: string; client_id: string; full_name: string; email: string; phone: string; company: string; service_interest: string; message: string; source: string; status: string; assigned_to: string | null; external_provider: string; source_metadata: unknown; created_at: string; updated_at: string };
type AppointmentRow = { id: string; lead_id: string; title: string; starts_at: string; ends_at: string; timezone: string; status: string; location: string; notes: string; assigned_to: string | null; created_at: string };
type TaskRow = { id: string; lead_id: string | null; appointment_id: string | null; title: string; description: string; due_at: string | null; priority: string; status: string; assigned_to: string | null; completed_at: string | null; created_at: string };
type ActivityRow = { id: string; lead_id: string; activity_type: string; title: string; detail: string; created_at: string };
type ChatMessageRow = { id: string; conversation_id: string; direction: "inbound" | "outbound" | "system"; sender_name: string; body: string; status: string; created_at: string };
type ConversationRow = { id: string; client_id: string; subject: string; status: string; priority: string; last_message_at: string; updated_at: string };
type ReceptionistSessionRow = { conversation_id: string; state: string; ai_enabled: boolean; visitor_name: string; visitor_email: string; visitor_phone: string };

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

async function readAgencyTeam(url: string, serviceKey: string, agencyId: string) {
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

async function readTeam(url: string, serviceKey: string, clientOrganizationId: string) {
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(clientOrganizationId)}&select=parent_organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const organizations = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as Array<{ parent_organization_id?: string }> : [];
  return readAgencyTeam(url, serviceKey, organizations[0]?.parent_organization_id || clientOrganizationId);
}

function agencyOrganizationId(context: AuthContext) {
  return context.memberships.find((membership) => membership.kind === "agency" && membership.role !== "client")?.organizationId
    || (context.organizationRole !== "client" ? context.organizationId : null);
}

async function readAccessibleClients(url: string, serviceKey: string, context: AuthContext) {
  const agencyId = agencyOrganizationId(context);
  if (!agencyId) {
    const client = await resolveClient(url, serviceKey, context, context.clientId || "");
    return client ? [client] : [];
  }
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?or=(id.eq.${encodeURIComponent(agencyId)},parent_organization_id.eq.${encodeURIComponent(agencyId)})&status=eq.active&select=id`, { headers: serviceHeaders(serviceKey) });
  const organizations = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as OrganizationRow[] : [];
  const organizationIds = organizations.map((organization) => organization.id).filter((id) => uuidPattern.test(id));
  if (!organizationIds.length) return [];
  const clientResponse = await fetch(`${url}/rest/v1/clients?organization_id=in.(${organizationIds.join(",")})&select=id,organization_id,name&order=name.asc`, { headers: serviceHeaders(serviceKey) });
  return clientResponse.ok ? await clientResponse.json().catch(() => []) as ClientRow[] : [];
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

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, clients: ClientRow[], client: ClientRow | null) {
  const scopedClients = client ? [client] : clients;
  const clientIds = scopedClients.map((row) => row.id).filter((id) => uuidPattern.test(id));
  const clientFilter = clientIds.length === 1
    ? `eq.${encodeURIComponent(clientIds[0])}`
    : clientIds.length > 1
      ? `in.(${clientIds.join(",")})`
      : "eq.00000000-0000-0000-0000-000000000000";
  const agencyId = agencyOrganizationId(context);
  const teamPromise = client?.organization_id
    ? readTeam(url, serviceKey, client.organization_id)
    : agencyId
      ? readAgencyTeam(url, serviceKey, agencyId)
      : Promise.resolve([]);
  const [leadResponse, appointmentResponse, taskResponse, activityResponse, conversationResponse, team] = await Promise.all([
    fetch(`${url}/rest/v1/crm_leads?client_id=${clientFilter}&select=*&order=created_at.desc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_appointments?client_id=${clientFilter}&select=*&order=starts_at.asc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_tasks?client_id=${clientFilter}&select=*&order=due_at.asc.nullslast,created_at.desc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/crm_activities?client_id=${clientFilter}&select=id,lead_id,activity_type,title,detail,created_at&order=created_at.desc&limit=100`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/conversations?client_id=${clientFilter}&channel=eq.webchat&archived_at=is.null&select=id,client_id,subject,status,priority,last_message_at,updated_at&order=last_message_at.desc.nullslast,updated_at.desc&limit=100`, { headers: serviceHeaders(serviceKey) }),
    teamPromise,
  ]);
  if (![leadResponse, appointmentResponse, taskResponse, activityResponse, conversationResponse].every((response) => response.ok)) return null;
  const leads = await leadResponse.json().catch(() => []) as LeadRow[];
  const appointments = await appointmentResponse.json().catch(() => []) as AppointmentRow[];
  const tasks = await taskResponse.json().catch(() => []) as TaskRow[];
  const activities = await activityResponse.json().catch(() => []) as ActivityRow[];
  const conversations = await conversationResponse.json().catch(() => []) as ConversationRow[];
  const chatLeadPairs = leads.flatMap((lead) => {
    if (lead.external_provider !== "website_chat") return [];
    const conversationId = crmConversationId(lead.source_metadata);
    return conversationId ? [{ leadId: lead.id, conversationId }] : [];
  });
  const leadByConversation = new Map(chatLeadPairs.map((pair) => [pair.conversationId, pair.leadId]));
  const conversationIds = Array.from(new Set(conversations.map((conversation) => conversation.id)));
  let chatMessages: ChatMessageRow[] = [];
  let receptionistSessions: ReceptionistSessionRow[] = [];
  if (conversationIds.length) {
    const [messageResponse, sessionResponse] = await Promise.all([
      fetch(`${url}/rest/v1/messages?conversation_id=in.(${conversationIds.join(",")})&channel=eq.webchat&select=id,conversation_id,direction,sender_name,body,status,created_at&order=created_at.asc`, { headers: serviceHeaders(serviceKey) }),
      fetch(`${url}/rest/v1/receptionist_sessions?conversation_id=in.(${conversationIds.join(",")})&select=conversation_id,state,ai_enabled,visitor_name,visitor_email,visitor_phone`, { headers: serviceHeaders(serviceKey) }),
    ]);
    chatMessages = messageResponse.ok ? await messageResponse.json().catch(() => []) as ChatMessageRow[] : [];
    receptionistSessions = sessionResponse.ok ? await sessionResponse.json().catch(() => []) as ReceptionistSessionRow[] : [];
  }
  const messageGroups = new Map<string, ChatMessageRow[]>();
  for (const chatMessage of chatMessages) {
    const messages = messageGroups.get(chatMessage.conversation_id) || [];
    messages.push(chatMessage);
    messageGroups.set(chatMessage.conversation_id, messages);
  }
  const sessionByConversation = new Map(receptionistSessions.map((session) => [session.conversation_id, session]));
  const websiteChats = conversations.map((conversation) => {
    const receptionistSession = sessionByConversation.get(conversation.id);
    const messages = messageGroups.get(conversation.id) || [];
    const latestMessage = messages[messages.length - 1];
    return {
      leadId: leadByConversation.get(conversation.id) || null,
      conversationId: conversation.id,
      clientId: conversation.client_id,
      visitorName: receptionistSession?.visitor_name || messages.find((message) => message.direction === "inbound")?.sender_name || "Website visitor",
      visitorEmail: receptionistSession?.visitor_email || "",
      visitorPhone: receptionistSession?.visitor_phone || "",
      status: conversation.status,
      priority: conversation.priority,
      lastMessageAt: conversation.last_message_at || conversation.updated_at,
      latestMessage: latestMessage?.body || "New website conversation",
      state: receptionistSession?.state || (leadByConversation.has(conversation.id) ? "qualified" : "anonymous"),
      aiEnabled: receptionistSession?.ai_enabled ?? false,
      messages,
    };
  });
  return {
    scope: { type: client ? "client" : "organization", clientId: client?.id || null, label: client?.name || "All leads" },
    client: client ? { id: client.id, name: client.name } : null,
    clients: clients.map((row) => ({ id: row.id, name: row.name })),
    canManage: hasOrganizationPermission(context, "crm.manage") && context.organizationRole !== "client",
    leads,
    appointments,
    tasks,
    activities,
    websiteChats,
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
  if (requestedClientId && !uuidPattern.test(requestedClientId)) return authJson({ error: "Choose a valid client." }, 400);
  if (requestedClientId) {
    const resolved = await authenticatedClient(request, env, requestedClientId);
    if ("response" in resolved) return resolved.response;
    const clients = await readAccessibleClients(resolved.url, resolved.serviceKey, resolved.context);
    const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, clients, resolved.client);
    if (!snapshot) return authJson({ error: "CRM storage is not ready. Apply supabase/crm.sql first." }, 503);
    return authJson({ snapshot });
  }
  const auth = await requireAuth(request, env, { permission: "crm.read" });
  if ("response" in auth) return auth.response;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return authJson({ error: "CRM storage is not configured." }, 500);
  const clients = await readAccessibleClients(url, serviceKey, auth.context);
  const customerClient = auth.context.organizationRole === "client" || (!auth.context.organizationRole && auth.context.role === "customer")
    ? clients.find((client) => client.id === auth.context.clientId) || clients[0] || null
    : null;
  const snapshot = await readSnapshot(url, serviceKey, auth.context, clients, customerClient);
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
  } else if (action === "reply_to_website_chat") {
    const requestedConversationId = clean(input?.conversationId, 36);
    const lead = leadId ? await readLead(url, serviceKey, client.id, leadId) : null;
    const body = clean(input?.body, 2000);
    const conversationId = requestedConversationId || (lead ? crmConversationId(lead.source_metadata) : "");
    if (!uuidPattern.test(conversationId) || !body) return authJson({ error: "Choose a website conversation and enter a reply." }, 400);
    if (lead && (lead.external_provider !== "website_chat" || crmConversationId(lead.source_metadata) !== conversationId)) return authJson({ error: "That lead is not linked to this website conversation." }, 400);
    const conversationResponse = await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(client.id)}&channel=eq.webchat&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
    const conversations = conversationResponse.ok ? await conversationResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    if (!conversations[0]?.id) return authJson({ error: "That website chat is no longer available." }, 404);
    const sender = team.find((member) => member.id === context.userId);
    const senderName = sender?.name || "Joseph";
    const ownershipResponse = await fetch(`${url}/rest/v1/receptionist_sessions?conversation_id=eq.${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ state: "staff_owned", ai_enabled: false, last_seen_at: now, updated_at: now }),
    });
    if (!ownershipResponse.ok) return authJson({ error: "The chat could not be transferred from the AI receptionist to staff." }, 502);
    const messageResponse = await fetch(`${url}/rest/v1/messages`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({
        organization_id: organizationId,
        client_id: client.id,
        conversation_id: conversationId,
        direction: "outbound",
        channel: "webchat",
        status: "sent",
        sender_name: senderName,
        sender_address: sender?.email || "",
        recipients: [],
        subject: "Website chat",
        body,
        client_visible: false,
        sent_by: context.userId,
        sent_at: now,
      }),
    });
    const messages = messageResponse.ok ? await messageResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    const messageId = messages[0]?.id || "";
    if (!messageResponse.ok || !uuidPattern.test(messageId)) return authJson({ error: "The website-chat reply could not be sent." }, 502);
    await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ last_message_at: now, updated_at: now }) });
    entityId = messageId;
    entityType = "message";
    lifecycleAction = "crm.website_chat.replied";
    if (lead) await writeActivity(url, serviceKey, { organizationId, clientId: client.id, leadId: lead.id, type: "chat.replied", title: "Website chat reply sent", detail: `${senderName} replied to ${lead.full_name} in the website chat.`, userId: context.userId, metadata: { conversation_id: conversationId, message_id: messageId } });
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
  const clients = await readAccessibleClients(url, serviceKey, context);
  const snapshot = await readSnapshot(url, serviceKey, context, clients, client);
  if (!snapshot) return authJson({ error: "The change saved, but the refreshed CRM view is unavailable." }, 502);
  return authJson({ snapshot, message: "CRM workflow updated." });
};
