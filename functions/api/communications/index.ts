import {
  authDisplayName,
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "../../_shared/auth";
import { createNotification } from "../../_shared/notifications";
import {
  buildTransactionalEmailHtml,
  emailConfigured,
  sendTransactionalEmail,
  type EmailEnv,
} from "../../_shared/email";
import { MAX_COMMUNICATION_ATTACHMENTS_TOTAL_BYTES } from "../../_shared/communication-attachments";
import {
  normalizeE164,
  sendTwilioSms,
  twilioSmsConfigured,
  twilioVoiceConfigured,
  type TwilioEnv,
} from "../../_shared/twilio";

interface Env extends FunctionEnv, EmailEnv, TwilioEnv {}

type ClientRow = { id: string; organization_id: string | null; name: string; industry: string; location: string };
type ConversationRow = { id: string; subject: string; channel: string; status: string; priority: string; category: string; client_visible: boolean; archived_at: string | null; archived_by: string | null; last_message_at: string; created_at: string };
type MessageRow = { id: string; conversation_id: string; direction: string; channel: string; status: string; sender_name: string; sender_address: string; recipients: unknown; subject: string; body: string; provider_message_id: string | null; error_detail: string; client_visible: boolean; sent_at: string | null; created_at: string };
type AttachmentRow = { id: string; message_id: string; file_name: string; content_type: string; byte_size: number; storage_bucket: string; storage_path: string; created_at: string };
type ConsentRow = { id: string; channel: "sms" | "voice"; address: string; status: "pending" | "granted" | "revoked"; source: string; evidence: string; granted_at: string | null; revoked_at: string | null; updated_at: string };
type SmsEventRow = { id: string; direction: "inbound" | "outbound" | "system"; status: string; from_address: string; to_address: string; error_detail: string; occurred_at: string };
type CallRecordRow = { id: string; direction: "inbound" | "outbound"; status: string; from_address: string; to_address: string; duration_seconds: number; voicemail_url: string; transcript: string; created_at: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const conversationStatuses = new Set(["open", "pending", "closed"]);
const conversationPriorities = new Set(["normal", "high", "urgent"]);
const conversationCategories = new Set(["general", "sales", "onboarding", "project", "support", "billing"]);

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

async function readSmsVoiceSnapshot(url: string, serviceKey: string, client: ClientRow, env: Env) {
  const [consentResponse, smsResponse, callsResponse] = await Promise.all([
    fetch(`${url}/rest/v1/communication_consents?client_id=eq.${encodeURIComponent(client.id)}&select=id,channel,address,status,source,evidence,granted_at,revoked_at,updated_at&order=updated_at.desc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/sms_events?client_id=eq.${encodeURIComponent(client.id)}&select=id,direction,status,from_address,to_address,error_detail,occurred_at&order=occurred_at.desc&limit=12`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/call_records?client_id=eq.${encodeURIComponent(client.id)}&select=id,direction,status,from_address,to_address,duration_seconds,voicemail_url,transcript,created_at&order=created_at.desc&limit=12`, { headers: serviceHeaders(serviceKey) }),
  ]);
  const migrationReady = ![consentResponse, smsResponse, callsResponse].some((response) => response.status === 404);
  if (!migrationReady) return {
    migrationReady: false,
    provider: "twilio" as const,
    senderAddress: normalizeE164(env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER),
    consents: [] as ConsentRow[],
    recentSmsEvents: [] as SmsEventRow[],
    recentCalls: [] as CallRecordRow[],
  };
  if (![consentResponse, smsResponse, callsResponse].every((response) => response.ok)) throw new Error("SMS and voice records could not be loaded.");
  return {
    migrationReady: true,
    provider: "twilio" as const,
    senderAddress: normalizeE164(env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER),
    consents: await consentResponse.json().catch(() => []) as ConsentRow[],
    recentSmsEvents: await smsResponse.json().catch(() => []) as SmsEventRow[],
    recentCalls: await callsResponse.json().catch(() => []) as CallRecordRow[],
  };
}

function storageObjectUrl(url: string, bucket: string, path: string) {
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length))),
    );
  }
  return btoa(binary);
}

async function readAttachments(url: string, serviceKey: string, messageIds: string[]) {
  if (!messageIds.length) return [] as AttachmentRow[];
  const response = await fetch(
    `${url}/rest/v1/message_attachments?message_id=in.(${messageIds.join(",")})&select=id,message_id,file_name,content_type,byte_size,storage_bucket,storage_path,created_at&order=created_at.asc`,
    { headers: serviceHeaders(serviceKey) },
  );
  // Keep existing Inbox email usable during the brief deploy-before-migration window.
  if (response.status === 404) return [] as AttachmentRow[];
  if (!response.ok) throw new Error("Secure attachment records could not be loaded.");
  return response.json().catch(() => []) as Promise<AttachmentRow[]>;
}

async function loadProviderAttachments(url: string, serviceKey: string, messageId: string) {
  const attachments = await readAttachments(url, serviceKey, [messageId]);
  const totalBytes = attachments.reduce((total, attachment) => total + Number(attachment.byte_size || 0), 0);
  if (totalBytes > MAX_COMMUNICATION_ATTACHMENTS_TOTAL_BYTES) throw new Error("Attachments for one email can total up to 20 MB.");
  return Promise.all(attachments.map(async (attachment) => {
    const response = await fetch(storageObjectUrl(url, attachment.storage_bucket, attachment.storage_path), {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) throw new Error(`${attachment.file_name} could not be read from secure storage.`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== Number(attachment.byte_size)) throw new Error(`${attachment.file_name} did not pass the secure size check.`);
    return {
      filename: attachment.file_name,
      content: arrayBufferToBase64(buffer),
      contentType: attachment.content_type,
    };
  }));
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

async function updateReceptionistOwnership(url: string, serviceKey: string, input: {
  conversationId: string;
  organizationId: string;
  clientId: string;
  state: "staff_owned" | "closed";
}) {
  const sessionResponse = await fetch(
    `${url}/rest/v1/receptionist_sessions?conversation_id=eq.${encodeURIComponent(input.conversationId)}&select=id&limit=1`,
    { headers: serviceHeaders(serviceKey) },
  );
  if (sessionResponse.status === 404) return;
  const sessions = sessionResponse.ok ? await sessionResponse.json().catch(() => []) as Array<{ id?: string }> : [];
  const sessionId = sessions[0]?.id || "";
  if (!uuidPattern.test(sessionId)) return;
  const now = new Date().toISOString();
  await Promise.allSettled([
    fetch(`${url}/rest/v1/receptionist_sessions?id=eq.${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ state: input.state, ai_enabled: false, updated_at: now }),
    }),
    fetch(`${url}/rest/v1/receptionist_actions`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({
        organization_id: input.organizationId,
        client_id: input.clientId,
        session_id: sessionId,
        action_type: input.state === "closed" ? "session_closed" : "staff_takeover",
        status: "completed",
        idempotency_key: `${input.state}:${sessionId}`,
        input: { conversation_id: input.conversationId },
        output: { ai_enabled: false },
      }),
    }),
  ]);
}

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, client: ClientRow, env: Env) {
  const clientView = isClientContext(context);
  const conversationVisibility = clientView ? "&client_visible=eq.true&archived_at=is.null" : "";
  const messageVisibility = clientView ? "&client_visible=eq.true" : "";
  const conversationResponse = await fetch(`${url}/rest/v1/conversations?client_id=eq.${encodeURIComponent(client.id)}${conversationVisibility}&select=id,subject,channel,status,priority,category,client_visible,archived_at,archived_by,last_message_at,created_at&order=last_message_at.desc`, { headers: serviceHeaders(serviceKey) });
  if (!conversationResponse.ok) return null;
  const conversations = await conversationResponse.json().catch(() => []) as ConversationRow[];
  let messages: MessageRow[] = [];
  let attachments: AttachmentRow[] = [];
  if (conversations.length) {
    const messageResponse = await fetch(`${url}/rest/v1/messages?conversation_id=in.(${conversations.map((conversation) => conversation.id).join(",")})${messageVisibility}&select=id,conversation_id,direction,channel,status,sender_name,sender_address,recipients,subject,body,provider_message_id,error_detail,client_visible,sent_at,created_at&order=created_at.asc`, { headers: serviceHeaders(serviceKey) });
    if (!messageResponse.ok) return null;
    messages = await messageResponse.json().catch(() => []) as MessageRow[];
    try {
      attachments = await readAttachments(url, serviceKey, messages.map((message) => message.id));
    } catch {
      return null;
    }
  }
  const normalized = conversations.map((conversation) => ({
    ...conversation,
    category: conversationCategories.has(conversation.category) ? conversation.category : "general",
    archived_at: conversation.archived_at || null,
    archived_by: conversation.archived_by || null,
    messages: messages.filter((message) => message.conversation_id === conversation.id).map((message) => ({
      ...message,
      recipients: recipients(message.recipients),
      attachments: attachments
        .filter((attachment) => attachment.message_id === message.id)
        .map(({ id, message_id, file_name, content_type, byte_size, created_at }) => ({ id, message_id, file_name, content_type, byte_size, created_at })),
    })),
  }));
  const allMessages = normalized.flatMap((conversation) => conversation.messages);
  const smsVoice = await readSmsVoiceSnapshot(url, serviceKey, client, env);
  return {
    client: { id: client.id, name: client.name, industry: client.industry || "", location: client.location || "" },
    canManage: hasOrganizationPermission(context, "communications.manage") && !clientView,
    isClient: clientView,
    delivery: {
      internal: "ready",
      email: emailConfigured(env) ? "ready" : "draft_only",
      sms: !smsVoice.migrationReady ? "migration_required" : twilioSmsConfigured(env) ? "ready" : "setup_required",
      voice: !smsVoice.migrationReady ? "migration_required" : twilioVoiceConfigured(env) ? "ready" : "setup_required",
    },
    smsVoice,
    conversations: normalized,
    summary: {
      openConversations: normalized.filter((conversation) => !conversation.archived_at && conversation.status === "open").length,
      pendingConversations: normalized.filter((conversation) => !conversation.archived_at && conversation.status === "pending").length,
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
  const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, resolved.client, env);
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
    const category = clean(input?.category, 30);
    if (!uuidPattern.test(conversationId) || !conversationStatuses.has(status) || !conversationPriorities.has(priority) || !conversationCategories.has(category)) return authJson({ error: "Choose a valid conversation category, status, and priority." }, 400);
    const response = await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(client.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ status, priority, category, updated_at: new Date().toISOString() }) });
    const rows = response.ok ? await response.json().catch(() => []) as ConversationRow[] : [];
    if (!response.ok || !rows[0]) return authJson({ error: "That conversation could not be updated." }, 400);
    if (rows[0].channel === "webchat" && status === "closed") {
      await updateReceptionistOwnership(url, serviceKey, { conversationId, organizationId, clientId: client.id, state: "closed" });
    }
    await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "communications.conversation_updated", entityType: "conversation", entityId: conversationId, clientId: client.id, metadata: { status, priority, category } });
    const snapshot = await readSnapshot(url, serviceKey, context, client, env);
    return authJson({ message: "Conversation updated.", snapshot });
  }

  if (action === "archive_conversation") {
    if (clientView) return authJson({ error: "Only workspace staff can archive conversations." }, 403);
    const conversationId = clean(input?.conversationId, 36);
    const archived = input?.archived === true;
    if (!uuidPattern.test(conversationId)) return authJson({ error: "Choose a valid conversation." }, 400);
    const now = new Date().toISOString();
    const response = await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify(archived
        ? { archived_at: now, archived_by: context.userId, status: "closed", updated_at: now }
        : { archived_at: null, archived_by: null, status: "open", updated_at: now }),
    });
    const rows = response.ok ? await response.json().catch(() => []) as ConversationRow[] : [];
    if (!response.ok || !rows[0]) return authJson({ error: "That conversation could not be archived." }, 400);
    if (archived && rows[0].channel === "webchat") {
      await updateReceptionistOwnership(url, serviceKey, { conversationId, organizationId, clientId: client.id, state: "closed" });
    }
    await writeLifecycle(url, serviceKey, {
      organizationId,
      userId: context.userId,
      action: archived ? "communications.conversation_archived" : "communications.conversation_unarchived",
      entityType: "conversation",
      entityId: conversationId,
      clientId: client.id,
    });
    const snapshot = await readSnapshot(url, serviceKey, context, client, env);
    return authJson({ message: archived ? "Conversation archived." : "Conversation restored.", snapshot });
  }

  if (action === "send_email") {
    if (clientView) return authJson({ error: "Only workspace staff can send transactional email." }, 403);
    if (!emailConfigured(env)) return authJson({ error: "Transactional email is not configured. Add the verified provider secrets before sending." }, 503);
    const messageId = clean(input?.messageId, 36);
    if (!uuidPattern.test(messageId)) return authJson({ error: "Choose a valid email draft." }, 400);
    const messageResponse = await fetch(
      `${url}/rest/v1/messages?id=eq.${encodeURIComponent(messageId)}&client_id=eq.${encodeURIComponent(client.id)}&channel=eq.email&direction=eq.outbound&select=id,conversation_id,direction,channel,status,sender_name,sender_address,recipients,subject,body,provider_message_id,error_detail,client_visible,sent_at,created_at&limit=1`,
      { headers: serviceHeaders(serviceKey) },
    );
    const messageRows = messageResponse.ok ? await messageResponse.json().catch(() => []) as MessageRow[] : [];
    const draft = messageRows[0];
    if (!draft) return authJson({ error: "That email draft is not available for this client." }, 404);
    if (draft.provider_message_id || (draft.status !== "draft" && draft.status !== "failed")) return authJson({ error: "This email has already been submitted. Create a new draft instead of sending it twice." }, 409);
    const draftRecipients = recipients(draft.recipients);
    if (!draftRecipients.length || draftRecipients.some((recipient) => !emailPattern.test(recipient))) return authJson({ error: "This draft needs at least one valid email recipient." }, 400);
    let providerAttachments;
    try {
      providerAttachments = await loadProviderAttachments(url, serviceKey, draft.id);
    } catch (attachmentError) {
      const detail = attachmentError instanceof Error ? attachmentError.message : "The secure attachments could not be prepared.";
      return authJson({ error: detail }, 502);
    }
    const idempotencyKey = `communications-email-${draft.id}`;
    const now = new Date().toISOString();
    const deliveryResponse = await fetch(`${url}/rest/v1/email_deliveries?on_conflict=message_id`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
      body: JSON.stringify({
        organization_id: organizationId,
        client_id: client.id,
        message_id: draft.id,
        template_key: "inbox_email",
        recipients: draftRecipients,
        subject: draft.subject,
        status: "queued",
        provider: "resend",
        idempotency_key: idempotencyKey,
        error_detail: "",
        updated_at: now,
      }),
    });
    const deliveryRows = deliveryResponse.ok ? await deliveryResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    if (!deliveryResponse.ok || !deliveryRows[0]?.id) return authJson({ error: "Transactional email storage is not ready. Apply supabase/transactional_email.sql first." }, 503);
    await fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(draft.id)}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ status: "queued", error_detail: "" }),
    });
    try {
      const provider = await sendTransactionalEmail(env, {
        to: draftRecipients,
        subject: draft.subject || "Update from Torres & Co. Technology",
        text: draft.body,
        html: buildTransactionalEmailHtml({ heading: draft.subject || "Client update", body: draft.body }),
        idempotencyKey,
        attachments: providerAttachments,
      });
      const sentAt = new Date().toISOString();
      await Promise.all([
        fetch(`${url}/rest/v1/email_deliveries?id=eq.${encodeURIComponent(deliveryRows[0].id || "")}`, {
          method: "PATCH",
          headers: serviceHeaders(serviceKey, "return=minimal"),
          body: JSON.stringify({ status: "sent", provider_message_id: provider.id, sent_at: sentAt, error_detail: "", updated_at: sentAt }),
        }),
        fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(draft.id)}`, {
          method: "PATCH",
          headers: serviceHeaders(serviceKey, "return=minimal"),
          body: JSON.stringify({ status: "sent", provider_message_id: provider.id, sent_at: sentAt, error_detail: "" }),
        }),
      ]);
      await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "communications.email_sent", entityType: "message", entityId: draft.id, clientId: client.id, metadata: { conversation_id: draft.conversation_id, provider: "resend", provider_message_id: provider.id, attachment_count: providerAttachments.length } });
      const snapshot = await readSnapshot(url, serviceKey, context, client, env);
      return authJson({ message: "Email accepted by the provider. Delivery status will update automatically.", snapshot });
    } catch (sendError) {
      const detail = sendError instanceof Error ? sendError.message.slice(0, 500) : "Email provider rejected the request.";
      const failedAt = new Date().toISOString();
      await Promise.allSettled([
        fetch(`${url}/rest/v1/email_deliveries?id=eq.${encodeURIComponent(deliveryRows[0].id || "")}`, {
          method: "PATCH",
          headers: serviceHeaders(serviceKey, "return=minimal"),
          body: JSON.stringify({ status: "failed", error_detail: detail, updated_at: failedAt }),
        }),
        fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(draft.id)}`, {
          method: "PATCH",
          headers: serviceHeaders(serviceKey, "return=minimal"),
          body: JSON.stringify({ status: "failed", error_detail: detail }),
        }),
      ]);
      await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "communications.email_failed", entityType: "message", entityId: draft.id, clientId: client.id, metadata: { conversation_id: draft.conversation_id, provider: "resend", error: detail } });
      return authJson({ error: `Email was not sent: ${detail}` }, 502);
    }
  }

  if (action === "set_channel_consent") {
    if (clientView) return authJson({ error: "Only workspace staff can record communication consent." }, 403);
    const channel = clean(input?.channel, 20);
    const address = normalizeE164(input?.address);
    const status = clean(input?.status, 20);
    const evidence = clean(input?.evidence, 500);
    if ((channel !== "sms" && channel !== "voice") || !address || !["pending", "granted", "revoked"].includes(status)) {
      return authJson({ error: "Choose SMS or voice, enter a valid mobile number, and select a consent status." }, 400);
    }
    if (status === "granted" && !evidence) return authJson({ error: "Add a short consent note before marking this number as granted." }, 400);
    const now = new Date().toISOString();
    const response = await fetch(`${url}/rest/v1/communication_consents?on_conflict=organization_id,client_id,channel,address`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
      body: JSON.stringify({
        organization_id: organizationId,
        client_id: client.id,
        channel,
        address,
        status,
        source: "admin_recorded",
        evidence,
        granted_at: status === "granted" ? now : null,
        revoked_at: status === "revoked" ? now : null,
        created_by: context.userId,
        updated_at: now,
      }),
    });
    if (response.status === 404) return authJson({ error: "SMS and voice storage is not ready. Apply supabase/sms_voice.sql first." }, 503);
    if (!response.ok) return authJson({ error: "The consent record could not be saved." }, 400);
    if (status === "revoked") {
      await fetch(`${url}/rest/v1/communication_suppressions?on_conflict=organization_id,channel,address`, {
        method: "POST",
        headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({ organization_id: organizationId, client_id: client.id, channel, address, reason: "consent_revoked", source: "admin_recorded", active: true, updated_at: now }),
      });
    } else if (status === "granted") {
      await fetch(`${url}/rest/v1/communication_suppressions?organization_id=eq.${encodeURIComponent(organizationId)}&channel=eq.${encodeURIComponent(channel)}&address=eq.${encodeURIComponent(address)}`, {
        method: "PATCH",
        headers: serviceHeaders(serviceKey, "return=minimal"),
        body: JSON.stringify({ active: false, updated_at: now }),
      });
    }
    await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "communications.consent_updated", entityType: "client", entityId: client.id, clientId: client.id, metadata: { channel, address, status } });
    const snapshot = await readSnapshot(url, serviceKey, context, client, env);
    return authJson({ message: `${channel.toUpperCase()} consent saved as ${status}.`, snapshot });
  }

  if (action === "send_sms") {
    if (clientView) return authJson({ error: "Only workspace staff can send SMS messages." }, 403);
    if (!twilioSmsConfigured(env)) return authJson({ error: "SMS is not connected. Add the Twilio production secrets before sending." }, 503);
    const messageId = clean(input?.messageId, 36);
    if (!uuidPattern.test(messageId)) return authJson({ error: "Choose a valid SMS draft." }, 400);
    const messageResponse = await fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(messageId)}&client_id=eq.${encodeURIComponent(client.id)}&channel=eq.sms&direction=eq.outbound&select=id,conversation_id,direction,channel,status,sender_name,sender_address,recipients,subject,body,provider_message_id,error_detail,client_visible,sent_at,created_at&limit=1`, { headers: serviceHeaders(serviceKey) });
    const messageRows = messageResponse.ok ? await messageResponse.json().catch(() => []) as MessageRow[] : [];
    const draft = messageRows[0];
    if (!draft) return authJson({ error: "That SMS draft is not available for this client." }, 404);
    if (draft.provider_message_id || (draft.status !== "draft" && draft.status !== "failed")) return authJson({ error: "This SMS has already been submitted." }, 409);
    const recipient = normalizeE164(recipients(draft.recipients)[0]);
    if (!recipient) return authJson({ error: "This SMS draft needs one valid mobile recipient." }, 400);
    const [consentResponse, suppressionResponse] = await Promise.all([
      fetch(`${url}/rest/v1/communication_consents?client_id=eq.${encodeURIComponent(client.id)}&channel=eq.sms&address=eq.${encodeURIComponent(recipient)}&status=eq.granted&select=id&limit=1`, { headers: serviceHeaders(serviceKey) }),
      fetch(`${url}/rest/v1/communication_suppressions?organization_id=eq.${encodeURIComponent(organizationId)}&channel=eq.sms&address=eq.${encodeURIComponent(recipient)}&active=eq.true&select=id&limit=1`, { headers: serviceHeaders(serviceKey) }),
    ]);
    const consentRows = consentResponse.ok ? await consentResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    const suppressionRows = suppressionResponse.ok ? await suppressionResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    if (!consentRows[0]?.id || suppressionRows[0]?.id) return authJson({ error: "SMS was not sent because this number does not have active consent or has opted out." }, 403);
    const callbackBase = (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
    try {
      const provider = await sendTwilioSms(env, { to: recipient, body: draft.body, statusCallback: `${callbackBase}/api/webhooks/twilio` });
      const sentAt = new Date().toISOString();
      const senderAddress = normalizeE164(env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER);
      await Promise.all([
        fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(draft.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: provider.status, provider_message_id: provider.id, sent_at: sentAt, error_detail: "" }) }),
        fetch(`${url}/rest/v1/sms_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: organizationId, client_id: client.id, conversation_id: draft.conversation_id, message_id: draft.id, provider: "twilio", provider_message_id: provider.id, direction: "outbound", event_type: "submitted", status: provider.status, from_address: senderAddress, to_address: recipient, occurred_at: sentAt }) }),
      ]);
      await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "communications.sms_sent", entityType: "message", entityId: draft.id, clientId: client.id, metadata: { conversation_id: draft.conversation_id, provider_message_id: provider.id } });
      const snapshot = await readSnapshot(url, serviceKey, context, client, env);
      return authJson({ message: "SMS accepted by Twilio. Delivery status will update automatically.", snapshot });
    } catch (sendError) {
      const detail = sendError instanceof Error ? sendError.message.slice(0, 500) : "Twilio rejected the request.";
      await fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(draft.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "failed", error_detail: detail }) });
      return authJson({ error: `SMS was not sent: ${detail}` }, 502);
    }
  }

  if (action !== "create_conversation" && action !== "add_message") return authJson({ error: "That communications action is not supported." }, 400);
  const requestedChannel = clean(input?.channel, 20);
  let channel = clientView ? "internal" : requestedChannel === "email" || requestedChannel === "sms" ? requestedChannel : "internal";
  const subject = clean(input?.subject, 180);
  const body = clean(input?.body, 8000);
  const messageRecipients = recipients(input?.recipients);
  if (!body) return authJson({ error: "Write a message before saving." }, 400);
  if (channel === "email" && !messageRecipients.length) return authJson({ error: "Add at least one email recipient before saving the draft." }, 400);
  if (channel === "email" && messageRecipients.some((recipient) => !emailPattern.test(recipient))) return authJson({ error: "Use a valid email address for every recipient." }, 400);
  if (channel === "sms" && (messageRecipients.length !== 1 || !normalizeE164(messageRecipients[0]))) return authJson({ error: "Add one valid mobile number including its country code." }, 400);
  const now = new Date().toISOString();
  let conversationId = clean(input?.conversationId, 36);
  let conversationSubject = subject;

  if (action === "create_conversation") {
    if (!subject) return authJson({ error: "Add a subject for the new conversation." }, 400);
    const category = clean(input?.category, 30) || "general";
    if (!conversationCategories.has(category)) return authJson({ error: "Choose a valid conversation category." }, 400);
    const response = await fetch(`${url}/rest/v1/conversations`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ organization_id: organizationId, client_id: client.id, subject, channel, status: "open", priority: "normal", category, client_visible: channel === "internal", last_message_at: now, created_by: context.userId }),
    });
    const rows = response.ok ? await response.json().catch(() => []) as ConversationRow[] : [];
    if (!response.ok || !rows[0]) return authJson({ error: "The conversation could not be created. Apply supabase/communications.sql if this is the first Phase 4 setup." }, response.status === 404 ? 503 : 400);
    conversationId = rows[0].id;
  } else {
    if (!uuidPattern.test(conversationId)) return authJson({ error: "Choose a conversation before replying." }, 400);
    const response = await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id,subject,channel,client_visible,archived_at&limit=1`, { headers: serviceHeaders(serviceKey) });
    const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string; subject?: string; channel?: string; client_visible?: boolean; archived_at?: string | null }> : [];
    if (!rows[0]?.id || (clientView && !rows[0].client_visible)) return authJson({ error: "That conversation is not available in this client workspace." }, 404);
    if (rows[0].archived_at) return authJson({ error: "Restore this conversation before replying." }, 409);
    conversationSubject = clean(rows[0].subject, 180) || "Conversation";
    channel = rows[0].channel === "webchat" ? "webchat" : rows[0].channel === "email" || rows[0].channel === "sms" ? rows[0].channel : "internal";
  }

  const senderName = authDisplayName(context, clientView ? "Client" : "Torres & Co. team");
  const senderAddress = clean(input?.senderAddress, 320) || context.email || "";
  const direction = clientView ? "inbound" : "outbound";
  const status = channel === "email" || channel === "sms" ? "draft" : clientView ? "received" : "sent";
  const clientVisible = channel === "internal";
  const messageResponse = await fetch(`${url}/rest/v1/messages`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({ organization_id: organizationId, client_id: client.id, conversation_id: conversationId, direction, channel, status, sender_name: senderName, sender_address: senderAddress, recipients: messageRecipients, subject: subject || conversationSubject, body, client_visible: clientVisible, sent_by: context.userId, sent_at: channel === "internal" || channel === "webchat" ? now : null }),
  });
  const messageRows = messageResponse.ok ? await messageResponse.json().catch(() => []) as MessageRow[] : [];
  if (!messageResponse.ok || !messageRows[0]) {
    if (action === "create_conversation") await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey) });
    return authJson({ error: "The message could not be saved." }, 400);
  }
  await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ last_message_at: now, updated_at: now }) });
  if (channel === "webchat" && !clientView) {
    await updateReceptionistOwnership(url, serviceKey, { conversationId, organizationId, clientId: client.id, state: "staff_owned" });
  }
  await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: channel === "email" ? "communications.email_draft_created" : channel === "sms" ? "communications.sms_draft_created" : channel === "webchat" ? "communications.webchat_reply" : "communications.message_shared", entityType: "message", entityId: messageRows[0].id, clientId: client.id, metadata: { conversation_id: conversationId, channel, status } });
  if (channel === "internal") await notifyParticipants(url, serviceKey, context, client, conversationId, conversationSubject, body);
  const snapshot = await readSnapshot(url, serviceKey, context, client, env);
  return authJson({ message: channel === "email" ? (emailConfigured(env) ? "Email draft saved for review. Send it when ready." : "Email draft saved. Connect an email provider before sending.") : channel === "sms" ? (twilioSmsConfigured(env) ? "SMS draft saved for consent and delivery review." : "SMS draft saved. Connect Twilio before sending.") : channel === "webchat" ? "Live reply sent. Automated responses are paused for this conversation." : "Message shared securely.", snapshot }, 201);
};
