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

type ClientRow = { id: string; organization_id: string | null; name: string; industry: string; location: string };
type ConversationRow = { id: string; subject: string; channel: string; status: string; priority: string; client_visible: boolean; last_message_at: string; created_at: string };
type MessageRow = { id: string; conversation_id: string; direction: string; channel: string; status: string; sender_name: string; sender_address: string; recipients: unknown; subject: string; body: string; client_visible: boolean; sent_at: string | null; created_at: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const conversationStatuses = new Set(["open", "pending", "closed"]);
const conversationPriorities = new Set(["normal", "high", "urgent"]);

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

function isClientContext(context: AuthContext) {
  return context.organizationRole === "client" || (!context.organizationRole && context.role === "customer");
}

function recipients(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 320)] : []).slice(0, 25);
}

async function resolveClient(url: string, serviceKey: string, context: AuthContext, requestedClientId: string) {
  const clientId = requestedClientId || context.clientId || "";
  if (!uuidPattern.test(clientId)) return null;
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,name,industry,location&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as ClientRow[] : [];
  return rows[0] || null;
}

async function organizationUserIds(url: string, serviceKey: string, clientOrganizationId: string, clientsOnly: boolean) {
  let organizationId = clientOrganizationId;
  if (!clientsOnly) {
    const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(clientOrganizationId)}&select=parent_organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
    const rows = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as Array<{ parent_organization_id?: string }> : [];
    organizationId = rows[0]?.parent_organization_id || clientOrganizationId;
  }
  const roleFilter = clientsOnly ? "&role=eq.client" : "&role=neq.client";
  const response = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active${roleFilter}&select=user_id`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ user_id?: string }> : [];
  return rows.map((row) => row.user_id).filter((id): id is string => Boolean(id && uuidPattern.test(id)));
}

async function writeLifecycle(url: string, serviceKey: string, input: { organizationId: string; userId: string; action: string; entityType: string; entityId: string; clientId: string; metadata?: Record<string, unknown> }) {
  const metadata = { client_id: input.clientId, ...(input.metadata || {}) };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, actor_user_id: input.userId, action: input.action, entity_type: input.entityType, entity_id: input.entityId, metadata }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: input.organizationId, event_type: input.action, aggregate_type: input.entityType, aggregate_id: input.entityId, payload: metadata }) }),
  ]);
}

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, client: ClientRow) {
  const clientView = isClientContext(context);
  const visibility = clientView ? "&client_visible=eq.true" : "";
  const conversationResponse = await fetch(`${url}/rest/v1/conversations?client_id=eq.${encodeURIComponent(client.id)}${visibility}&select=id,subject,channel,status,priority,client_visible,last_message_at,created_at&order=last_message_at.desc`, { headers: serviceHeaders(serviceKey) });
  if (!conversationResponse.ok) return null;
  const conversations = await conversationResponse.json().catch(() => []) as ConversationRow[];
  let messages: MessageRow[] = [];
  if (conversations.length) {
    const messageResponse = await fetch(`${url}/rest/v1/messages?conversation_id=in.(${conversations.map((conversation) => conversation.id).join(",")})${visibility}&select=id,conversation_id,direction,channel,status,sender_name,sender_address,recipients,subject,body,client_visible,sent_at,created_at&order=created_at.asc`, { headers: serviceHeaders(serviceKey) });
    if (!messageResponse.ok) return null;
    messages = await messageResponse.json().catch(() => []) as MessageRow[];
  }
  const normalized = conversations.map((conversation) => ({
    ...conversation,
    messages: messages.filter((message) => message.conversation_id === conversation.id).map((message) => ({ ...message, recipients: recipients(message.recipients) })),
  }));
  const allMessages = normalized.flatMap((conversation) => conversation.messages);
  return {
    client: { id: client.id, name: client.name, industry: client.industry || "", location: client.location || "" },
    canManage: hasOrganizationPermission(context, "communications.manage") && !clientView,
    isClient: clientView,
    delivery: { internal: "ready", email: "draft_only", sms: "not_configured", voice: "not_configured" },
    conversations: normalized,
    summary: {
      openConversations: normalized.filter((conversation) => conversation.status === "open").length,
      pendingConversations: normalized.filter((conversation) => conversation.status === "pending").length,
      sharedMessages: allMessages.filter((message) => message.client_visible && message.status !== "draft").length,
      emailDrafts: allMessages.filter((message) => message.channel === "email" && message.status === "draft").length,
    },
  };
}

async function authenticatedClient(request: Request, env: Env, requestedClientId: string) {
  const auth = await requireAuth(request, env, { permission: "communications.read" });
  if ("response" in auth) return auth;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: authJson({ error: "Communications storage is not configured." }, 500) };
  const client = await resolveClient(url, serviceKey, auth.context, requestedClientId);
  if (!client?.organization_id) return { response: authJson({ error: "Choose a client before opening the inbox." }, 404) };
  const scoped = await requireAuth(request, env, { clientId: client.id, permission: "communications.read" });
  if ("response" in scoped) return scoped;
  return { context: scoped.context, client, url, serviceKey };
}

async function notifyParticipants(url: string, serviceKey: string, context: AuthContext, client: ClientRow, conversationId: string, subject: string, body: string) {
  const senderIsClient = isClientContext(context);
  const userIds = await organizationUserIds(url, serviceKey, client.organization_id || "", !senderIsClient);
  await Promise.all(userIds.filter((userId) => userId !== context.userId).map((userId) => createNotification({
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  }, {
    userId,
    clientId: client.id,
    type: "action",
    title: senderIsClient ? `New client message: ${subject}` : `New shared update: ${subject}`,
    body: body.slice(0, 180),
    href: `/inbox/?client=${encodeURIComponent(client.id)}&conversation=${encodeURIComponent(conversationId)}`,
  })));
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const requestedClientId = new URL(request.url).searchParams.get("client") || "";
  if (requestedClientId && !uuidPattern.test(requestedClientId)) return authJson({ error: "Choose a valid client." }, 400);
  const resolved = await authenticatedClient(request, env, requestedClientId);
  if ("response" in resolved) return resolved.response;
  const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, resolved.client);
  if (!snapshot) return authJson({ error: "Communications storage is not ready. Apply supabase/communications.sql first." }, 503);
  return authJson({ snapshot });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = clean(input?.action, 60);
  const clientId = clean(input?.clientId, 36);
  if (!action || !uuidPattern.test(clientId)) return authJson({ error: "A valid communications action and client are required." }, 400);
  const resolved = await authenticatedClient(request, env, clientId);
  if ("response" in resolved) return resolved.response;
  const { context, client, url, serviceKey } = resolved;
  const organizationId = client.organization_id || "";
  const clientView = isClientContext(context);
  const canManage = hasOrganizationPermission(context, "communications.manage");
  if (!canManage) return authJson({ error: "Your organization role cannot update conversations." }, 403);

  if (action === "update_conversation") {
    if (clientView) return authJson({ error: "Only workspace staff can manage conversation status." }, 403);
    const conversationId = clean(input?.conversationId, 36);
    const status = clean(input?.status, 20);
    const priority = clean(input?.priority, 20);
    if (!uuidPattern.test(conversationId) || !conversationStatuses.has(status) || !conversationPriorities.has(priority)) return authJson({ error: "Choose a valid conversation status and priority." }, 400);
    const response = await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(client.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ status, priority, updated_at: new Date().toISOString() }) });
    const rows = response.ok ? await response.json().catch(() => []) as ConversationRow[] : [];
    if (!response.ok || !rows[0]) return authJson({ error: "That conversation could not be updated." }, 400);
    await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "communications.conversation_updated", entityType: "conversation", entityId: conversationId, clientId: client.id, metadata: { status, priority } });
    const snapshot = await readSnapshot(url, serviceKey, context, client);
    return authJson({ message: "Conversation updated.", snapshot });
  }

  if (action !== "create_conversation" && action !== "add_message") return authJson({ error: "That communications action is not supported." }, 400);
  const requestedChannel = clean(input?.channel, 20);
  const channel = clientView ? "internal" : requestedChannel === "email" ? "email" : "internal";
  const subject = clean(input?.subject, 180);
  const body = clean(input?.body, 8000);
  const messageRecipients = recipients(input?.recipients);
  if (!body) return authJson({ error: "Write a message before saving." }, 400);
  if (channel === "email" && !messageRecipients.length) return authJson({ error: "Add at least one email recipient before saving the draft." }, 400);
  if (channel === "email" && messageRecipients.some((recipient) => !emailPattern.test(recipient))) return authJson({ error: "Use a valid email address for every recipient." }, 400);
  const now = new Date().toISOString();
  let conversationId = clean(input?.conversationId, 36);
  let conversationSubject = subject;

  if (action === "create_conversation") {
    if (!subject) return authJson({ error: "Add a subject for the new conversation." }, 400);
    const response = await fetch(`${url}/rest/v1/conversations`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ organization_id: organizationId, client_id: client.id, subject, channel, status: "open", priority: "normal", client_visible: channel === "internal", last_message_at: now, created_by: context.userId }),
    });
    const rows = response.ok ? await response.json().catch(() => []) as ConversationRow[] : [];
    if (!response.ok || !rows[0]) return authJson({ error: "The conversation could not be created. Apply supabase/communications.sql if this is the first Phase 4 setup." }, response.status === 404 ? 503 : 400);
    conversationId = rows[0].id;
  } else {
    if (!uuidPattern.test(conversationId)) return authJson({ error: "Choose a conversation before replying." }, 400);
    const response = await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id,subject,client_visible&limit=1`, { headers: serviceHeaders(serviceKey) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string; subject?: string; client_visible?: boolean }> : [];
    if (!rows[0]?.id || (clientView && !rows[0].client_visible)) return authJson({ error: "That conversation is not available in this client workspace." }, 404);
    conversationSubject = clean(rows[0].subject, 180) || "Conversation";
  }

  const senderName = clean(input?.senderName, 160) || context.email || (clientView ? "Client" : "Torres & Co. team");
  const senderAddress = clean(input?.senderAddress, 320) || context.email || "";
  const direction = clientView ? "inbound" : "outbound";
  const status = channel === "email" ? "draft" : clientView ? "received" : "sent";
  const clientVisible = channel === "internal";
  const messageResponse = await fetch(`${url}/rest/v1/messages`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({ organization_id: organizationId, client_id: client.id, conversation_id: conversationId, direction, channel, status, sender_name: senderName, sender_address: senderAddress, recipients: messageRecipients, subject: subject || conversationSubject, body, client_visible: clientVisible, sent_by: context.userId, sent_at: channel === "internal" ? now : null }),
  });
  const messageRows = messageResponse.ok ? await messageResponse.json().catch(() => []) as MessageRow[] : [];
  if (!messageResponse.ok || !messageRows[0]) {
    if (action === "create_conversation") await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey) });
    return authJson({ error: "The message could not be saved." }, 400);
  }
  await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ last_message_at: now, updated_at: now }) });
  await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: channel === "email" ? "communications.email_draft_created" : "communications.message_shared", entityType: "message", entityId: messageRows[0].id, clientId: client.id, metadata: { conversation_id: conversationId, channel, status } });
  if (channel === "internal") await notifyParticipants(url, serviceKey, context, client, conversationId, conversationSubject, body);
  const snapshot = await readSnapshot(url, serviceKey, context, client);
  return authJson({ message: channel === "email" ? "Email draft saved. Connect an email provider before sending." : "Message shared securely.", snapshot }, 201);
};
