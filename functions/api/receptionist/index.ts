import { getSupabaseUrl, type FunctionEnv } from "../../_shared/auth";
import { createNotification } from "../../_shared/notifications";
import { websiteChatCrmHref } from "../../_shared/crm-chat";
import type { EmailEnv } from "../../_shared/email";
import { readCommunicationSettings } from "../../_shared/communications-settings";
import { sendLeadAcknowledgment } from "../../_shared/lead-acknowledgment";
import {
  DEFAULT_RECEPTIONIST_KNOWLEDGE,
  allowedReceptionistOrigins,
  answerReceptionist,
  cleanReceptionistText,
  createReceptionistToken,
  receptionistCorsHeaders,
  sha256,
  validReceptionistEmail,
  validReceptionistPhone,
  type KnowledgeEntry,
  type ReceptionistAiBinding,
} from "../../_shared/receptionist";

interface Env extends FunctionEnv, EmailEnv {
  AI?: ReceptionistAiBinding;
  RECEPTIONIST_CLIENT_ID?: string;
  RECEPTIONIST_ALLOWED_ORIGINS?: string;
}

type ClientRow = { id: string; organization_id: string | null; name: string };
type ConfigRow = {
  id: string;
  assistant_name: string;
  welcome_message: string;
  fallback_message: string;
  privacy_message: string;
};
type SessionRow = {
  id: string;
  organization_id: string;
  client_id: string;
  conversation_id: string;
  state: "anonymous" | "qualified" | "handoff" | "staff_owned" | "closed";
  ai_enabled: boolean;
  visitor_name: string;
  visitor_email: string;
  visitor_phone: string;
  expires_at: string;
};
type PublicMessage = {
  id: string;
  direction: "inbound" | "outbound" | "system";
  sender_name: string;
  body: string;
  status: string;
  created_at: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumBodyBytes = 12 * 1024;
const requestsPerMinute = 30;

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function json(data: Record<string, unknown>, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function resolveClient(url: string, serviceKey: string, clientId: string) {
  if (!uuidPattern.test(clientId)) return null;
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,name&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = response.ok ? await response.json().catch(() => []) as ClientRow[] : [];
  return rows[0]?.organization_id ? rows[0] : null;
}

async function readConfig(url: string, serviceKey: string, clientId: string) {
  const response = await fetch(`${url}/rest/v1/receptionist_configs?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,assistant_name,welcome_message,fallback_message,privacy_message&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  if (response.status === 404) return { migrationMissing: true as const, config: null };
  const rows = response.ok ? await response.json().catch(() => []) as ConfigRow[] : [];
  return { migrationMissing: false as const, config: rows[0] || null };
}

async function readKnowledge(url: string, serviceKey: string, clientId: string) {
  const response = await fetch(`${url}/rest/v1/receptionist_knowledge_entries?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=title,content,keywords&order=sort_order.asc&limit=100`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ title?: string; content?: string; keywords?: unknown }> : [];
  const entries = rows.flatMap((row): KnowledgeEntry[] => {
    const title = cleanReceptionistText(row.title, 160);
    const content = cleanReceptionistText(row.content, 4000);
    const keywords = Array.isArray(row.keywords) ? row.keywords.flatMap((keyword) => typeof keyword === "string" ? [cleanReceptionistText(keyword, 80)] : []).filter(Boolean) : [];
    return title && content ? [{ title, content, keywords }] : [];
  });
  return entries.length ? entries : DEFAULT_RECEPTIONIST_KNOWLEDGE;
}

async function readSession(url: string, serviceKey: string, token: string) {
  if (token.length < 32 || token.length > 160) return null;
  const tokenHash = await sha256(token);
  const response = await fetch(`${url}/rest/v1/receptionist_sessions?token_hash=eq.${tokenHash}&select=id,organization_id,client_id,conversation_id,state,ai_enabled,visitor_name,visitor_email,visitor_phone,expires_at&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = response.ok ? await response.json().catch(() => []) as SessionRow[] : [];
  const session = rows[0];
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return session;
}

async function publicMessages(url: string, serviceKey: string, conversationId: string) {
  const response = await fetch(`${url}/rest/v1/messages?conversation_id=eq.${encodeURIComponent(conversationId)}&channel=eq.webchat&select=id,direction,sender_name,body,status,created_at&order=created_at.asc&limit=200`, {
    headers: serviceHeaders(serviceKey),
  });
  return response.ok ? await response.json().catch(() => []) as PublicMessage[] : [];
}

async function insertMessage(url: string, serviceKey: string, input: {
  session: Pick<SessionRow, "organization_id" | "client_id" | "conversation_id">;
  direction: "inbound" | "outbound" | "system";
  senderName: string;
  senderAddress?: string;
  body: string;
}) {
  const now = new Date().toISOString();
  const response = await fetch(`${url}/rest/v1/messages`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify({
      organization_id: input.session.organization_id,
      client_id: input.session.client_id,
      conversation_id: input.session.conversation_id,
      direction: input.direction,
      channel: "webchat",
      status: input.direction === "inbound" ? "received" : "sent",
      sender_name: input.senderName,
      sender_address: input.senderAddress || "",
      recipients: [],
      subject: "Website chat",
      body: input.body,
      client_visible: false,
      sent_at: input.direction === "inbound" ? null : now,
    }),
  });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
  if (!rows[0]?.id) return "";
  await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(input.session.conversation_id)}`, {
    method: "PATCH",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ last_message_at: now, updated_at: now }),
  });
  return rows[0].id || "";
}

async function recordAction(url: string, serviceKey: string, session: SessionRow, actionType: string, input: Record<string, unknown> = {}, output: Record<string, unknown> = {}) {
  await fetch(`${url}/rest/v1/receptionist_actions`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ organization_id: session.organization_id, client_id: session.client_id, session_id: session.id, action_type: actionType, input, output }),
  });
}

async function agencyUserIds(url: string, serviceKey: string, organizationId: string) {
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=parent_organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const organizations = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as Array<{ parent_organization_id?: string }> : [];
  const agencyId = organizations[0]?.parent_organization_id || organizationId;
  const response = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(agencyId)}&status=eq.active&role=neq.client&select=user_id&limit=100`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ user_id?: string }> : [];
  return Array.from(new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id && uuidPattern.test(id)))));
}

async function notifyTeam(env: Env, url: string, serviceKey: string, session: SessionRow, title: string, body: string, href: string) {
  const userIds = await agencyUserIds(url, serviceKey, session.organization_id);
  await Promise.allSettled(userIds.map((userId) => createNotification(env, {
    userId,
    clientId: session.client_id,
    type: "action",
    title,
    body,
    href,
  })));
}

async function readSessionLead(url: string, serviceKey: string, sessionId: string) {
  const response = await fetch(`${url}/rest/v1/crm_leads?external_provider=eq.website_chat&external_submission_id=eq.${encodeURIComponent(sessionId)}&select=id&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
  return rows[0]?.id && uuidPattern.test(rows[0].id) ? rows[0].id : "";
}

async function applyRateLimit(url: string, serviceKey: string, request: Request, origin: string, token: string) {
  const remoteAddress = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucketHash = await sha256(`${origin}|${remoteAddress}|${token.slice(0, 32)}`);
  const date = new Date();
  date.setUTCSeconds(0, 0);
  const windowStart = date.toISOString();
  const query = `${url}/rest/v1/receptionist_rate_limits?bucket_hash=eq.${bucketHash}&window_start=eq.${encodeURIComponent(windowStart)}&select=request_count&limit=1`;
  const response = await fetch(query, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ request_count?: number }> : [];
  const count = Number(rows[0]?.request_count || 0);
  if (count >= requestsPerMinute) return false;
  if (count) {
    await fetch(`${url}/rest/v1/receptionist_rate_limits?bucket_hash=eq.${bucketHash}&window_start=eq.${encodeURIComponent(windowStart)}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ request_count: count + 1, updated_at: new Date().toISOString() }),
    });
  } else {
    await fetch(`${url}/rest/v1/receptionist_rate_limits`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ bucket_hash: bucketHash, window_start: windowStart, request_count: 1 }),
    });
  }
  return true;
}

async function lifecycle(url: string, serviceKey: string, session: SessionRow, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: session.organization_id, action, entity_type: entityType, entity_id: entityId, source: "website_receptionist", metadata: { client_id: session.client_id, session_id: session.id, ...metadata } }) }),
    fetch(`${url}/rest/v1/event_outbox`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: session.organization_id, event_type: action, aggregate_type: entityType, aggregate_id: entityId, payload: { client_id: session.client_id, session_id: session.id, ...metadata } }) }),
  ]);
}

async function createLead(url: string, serviceKey: string, session: SessionRow, input: Record<string, unknown>) {
  const fullName = cleanReceptionistText(input.name, 160);
  const email = cleanReceptionistText(input.email, 254).toLowerCase();
  const phone = cleanReceptionistText(input.phone, 40);
  const company = cleanReceptionistText(input.company, 160);
  const requestedService = cleanReceptionistText(input.service, 240);
  if (!fullName || (!email && !phone) || (email && !validReceptionistEmail(email)) || (phone && !validReceptionistPhone(phone))) {
    return { error: "Add your name and a valid email or phone number." };
  }
  const response = await fetch(`${url}/rest/v1/crm_leads?on_conflict=external_provider,external_submission_id`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      organization_id: session.organization_id,
      client_id: session.client_id,
      full_name: fullName,
      email,
      phone,
      company,
      service_interest: requestedService,
      message: "Contact details collected by the website receptionist after explicit consent.",
      source: "website",
      status: "new",
      external_provider: "website_chat",
      external_submission_id: session.id,
      source_metadata: { conversation_id: session.conversation_id, consent_to_contact: true },
    }),
  });
  const rows = response.ok ? await response.json().catch(() => []) as Array<{ id?: string }> : [];
  if (!response.ok || !rows[0]?.id) return { error: "Your request could not be saved. Please use the website contact form." };
  return { leadId: rows[0].id || "", fullName, email, phone, company, requestedService };
}

export const onRequestOptions = async ({ request, env }: { request: Request; env: Env }) => {
  const cors = receptionistCorsHeaders(request.headers.get("Origin") || "", env.RECEPTIONIST_ALLOWED_ORIGINS);
  return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
};

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const origin = request.headers.get("Origin") || "";
  const cors = receptionistCorsHeaders(origin, env.RECEPTIONIST_ALLOWED_ORIGINS);
  if (!cors) return new Response(JSON.stringify({ error: "This website is not allowed to use the receptionist." }), { status: 403, headers: { "Content-Type": "application/json" } });
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const clientId = env.RECEPTIONIST_CLIENT_ID?.trim() || "";
  if (!url || !serviceKey || !uuidPattern.test(clientId)) return json({ chatEnabled: false }, 200, cors);
  const client = await resolveClient(url, serviceKey, clientId);
  if (!client?.organization_id) return json({ chatEnabled: false }, 200, cors);
  const settings = await readCommunicationSettings(url, serviceKey, client.organization_id);
  return json({ chatEnabled: settings.websiteChatEnabled }, 200, cors);
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const origin = request.headers.get("Origin") || "";
  const cors = receptionistCorsHeaders(origin, env.RECEPTIONIST_ALLOWED_ORIGINS);
  if (!cors) return new Response(JSON.stringify({ error: "This website is not allowed to use the receptionist." }), { status: 403, headers: { "Content-Type": "application/json" } });
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) return json({ error: "Message is too large." }, 413, cors);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maximumBodyBytes) return json({ error: "Message is too large." }, 413, cors);
  const input = (() => { try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; } })();
  if (!input) return json({ error: "Invalid request." }, 400, cors);
  const action = cleanReceptionistText(input.action, 40);
  const token = cleanReceptionistText(input.token, 160);
  if (!action) return json({ error: "Choose a receptionist action." }, 400, cors);

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const clientId = env.RECEPTIONIST_CLIENT_ID?.trim() || "";
  if (!url || !serviceKey || !uuidPattern.test(clientId)) return json({ error: "The receptionist is not configured yet." }, 503, cors);
  if (!await applyRateLimit(url, serviceKey, request, origin, token || "new")) return json({ error: "Please wait a minute before sending another message." }, 429, cors);
  const client = await resolveClient(url, serviceKey, clientId);
  if (!client?.organization_id) return json({ error: "The receptionist workspace is unavailable." }, 503, cors);
  const communicationSettings = await readCommunicationSettings(url, serviceKey, client.organization_id);
  if (!communicationSettings.websiteChatEnabled) return json({ error: "Website chat is currently unavailable." }, 403, cors);
  const { config, migrationMissing } = await readConfig(url, serviceKey, client.id);
  if (migrationMissing) return json({ error: "The receptionist database migration has not been applied." }, 503, cors);
  const assistantName = config?.assistant_name || "Torres & Co. automated assistant";
  const welcomeMessage = config?.welcome_message || "Welcome to Torres & Co. Technology. I can help you find the right service or connect you with our team.";
  const fallbackMessage = config?.fallback_message || "I do not want to guess. I can collect your details and ask a Torres & Co. team member to follow up.";
  const privacyMessage = config?.privacy_message || "Do not share passwords, payment details, or other sensitive information in chat.";

  if (action === "start") {
    if (cleanReceptionistText(input.website, 200)) return json({ accepted: true }, 202, cors);
    if (!allowedReceptionistOrigins(env.RECEPTIONIST_ALLOWED_ORIGINS).has(origin.toLowerCase())) return json({ error: "This site is not authorized." }, 403, cors);
    const now = new Date().toISOString();
    const conversationResponse = await fetch(`${url}/rest/v1/conversations`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ organization_id: client.organization_id, client_id: client.id, subject: "Website chat · New visitor", channel: "webchat", status: "open", priority: "normal", category: "sales", client_visible: false, last_message_at: now }),
    });
    const conversations = conversationResponse.ok ? await conversationResponse.json().catch(() => []) as Array<{ id?: string }> : [];
    const conversationId = conversations[0]?.id || "";
    if (!uuidPattern.test(conversationId)) return json({ error: "A chat could not be started." }, 502, cors);
    const publicToken = createReceptionistToken();
    const tokenHash = await sha256(publicToken);
    const sessionResponse = await fetch(`${url}/rest/v1/receptionist_sessions`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ organization_id: client.organization_id, client_id: client.id, config_id: config?.id || null, conversation_id: conversationId, token_hash: tokenHash, state: "anonymous", ai_enabled: true, origin }),
    });
    const sessions = sessionResponse.ok ? await sessionResponse.json().catch(() => []) as SessionRow[] : [];
    const session = sessions[0];
    if (!session?.id) {
      await fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, { method: "DELETE", headers: serviceHeaders(serviceKey) });
      return json({ error: "A secure chat session could not be created." }, 502, cors);
    }
    await insertMessage(url, serviceKey, { session, direction: "outbound", senderName: assistantName, body: `${welcomeMessage}\n\n${privacyMessage}` });
    await recordAction(url, serviceKey, session, "session_started", { origin });
    return json({ token: publicToken, state: session.state, assistantName, messages: await publicMessages(url, serviceKey, conversationId) }, 201, cors);
  }

  const session = await readSession(url, serviceKey, token);
  if (!session || session.client_id !== client.id) return json({ error: "This chat has expired. Start a new conversation." }, 401, cors);
  await fetch(`${url}/rest/v1/receptionist_sessions?id=eq.${encodeURIComponent(session.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });

  if (action === "poll") return json({ state: session.state, aiEnabled: session.ai_enabled, messages: await publicMessages(url, serviceKey, session.conversation_id) }, 200, cors);

  if (action === "message") {
    const body = cleanReceptionistText(input.message, 1200);
    if (!body) return json({ error: "Write a message first." }, 400, cors);
    if (/password|passcode|credit card|social security|private key|api key/i.test(body)) return json({ error: "For your security, do not share passwords, payment details, IDs, or access keys in chat." }, 422, cors);
    const inboundId = await insertMessage(url, serviceKey, { session, direction: "inbound", senderName: session.visitor_name || "Website visitor", senderAddress: session.visitor_email || session.visitor_phone, body });
    if (!inboundId) return json({ error: "Your message could not be saved." }, 502, cors);
    const latestSession = await readSession(url, serviceKey, token);
    if (latestSession?.ai_enabled && latestSession.state !== "staff_owned" && latestSession.state !== "closed") {
      const answer = await answerReceptionist({ message: body, knowledge: await readKnowledge(url, serviceKey, client.id), fallback: fallbackMessage, ai: env.AI });
      const beforeReply = await readSession(url, serviceKey, token);
      if (beforeReply?.ai_enabled && beforeReply.state !== "staff_owned" && beforeReply.state !== "closed") {
        await insertMessage(url, serviceKey, { session: beforeReply, direction: "outbound", senderName: assistantName, body: answer.body });
        await recordAction(url, serviceKey, beforeReply, "faq_answered", { message_id: inboundId }, { source: answer.source, matched: answer.matched });
      }
    }
    return json({ state: (await readSession(url, serviceKey, token))?.state || session.state, messages: await publicMessages(url, serviceKey, session.conversation_id) }, 201, cors);
  }

  if (action === "identify") {
    if (input.confirmed !== true || input.consent !== true) return json({ error: "Confirm that Torres & Co. may use these details to respond." }, 422, cors);
    const lead = await createLead(url, serviceKey, session, input);
    if ("error" in lead) return json({ error: lead.error }, 422, cors);
    const now = new Date().toISOString();
    await Promise.all([
      fetch(`${url}/rest/v1/receptionist_sessions?id=eq.${encodeURIComponent(session.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ state: "qualified", visitor_name: lead.fullName, visitor_email: lead.email, visitor_phone: lead.phone, visitor_company: lead.company, requested_service: lead.requestedService, consent_to_contact: true, updated_at: now }) }),
      fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(session.conversation_id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ subject: `Website chat · ${lead.fullName}`, updated_at: now }) }),
      fetch(`${url}/rest/v1/crm_activities`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: session.organization_id, client_id: session.client_id, lead_id: lead.leadId, activity_type: "lead.created", title: "Website chat lead captured", detail: `${lead.fullName} consented to follow-up through the website receptionist.`, metadata: { conversation_id: session.conversation_id } }) }),
    ]);
    await insertMessage(url, serviceKey, { session, direction: "outbound", senderName: assistantName, body: "Thank you. Your contact details were saved for the Torres & Co. team. No appointment or service has been confirmed yet." });
    await recordAction(url, serviceKey, session, "lead_created", {}, { lead_id: lead.leadId });
    await lifecycle(url, serviceKey, session, "crm.lead.created", "crm_lead", lead.leadId, { conversation_id: session.conversation_id });
    if (lead.email) {
      try {
        await sendLeadAcknowledgment(env, {
          supabaseUrl: url,
          serviceKey,
          organizationId: session.organization_id,
          clientId: session.client_id,
          leadId: lead.leadId,
          email: lead.email,
          fullName: lead.fullName,
        });
      } catch (error) {
        console.error("Receptionist acknowledgment failed", error);
      }
    }
    await notifyTeam(env, url, serviceKey, { ...session, state: "qualified", visitor_name: lead.fullName, visitor_email: lead.email, visitor_phone: lead.phone }, "New receptionist lead", `${lead.fullName} requested follow-up${lead.requestedService ? ` about ${lead.requestedService}` : ""}.`, websiteChatCrmHref(lead.leadId));
    return json({ state: "qualified", saved: true, messages: await publicMessages(url, serviceKey, session.conversation_id) }, 201, cors);
  }

  if (action === "handoff") {
    if (input.confirmed !== true) return json({ error: "Confirm that you want a team member to join this conversation." }, 422, cors);
    const leadId = await readSessionLead(url, serviceKey, session.id);
    if (!leadId) return json({ error: "Share your name and a valid email or phone number before requesting a person." }, 422, cors);
    if (session.state !== "staff_owned" && session.state !== "closed") {
      const now = new Date().toISOString();
      await Promise.all([
        fetch(`${url}/rest/v1/receptionist_sessions?id=eq.${encodeURIComponent(session.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ state: "handoff", ai_enabled: false, updated_at: now }) }),
        fetch(`${url}/rest/v1/conversations?id=eq.${encodeURIComponent(session.conversation_id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ priority: "high", status: "open", updated_at: now }) }),
      ]);
      await insertMessage(url, serviceKey, { session, direction: "outbound", senderName: assistantName, body: "I have paused automated replies and notified the Torres & Co. team. A person can continue here when available." });
      await recordAction(url, serviceKey, session, "handoff_requested");
      await notifyTeam(env, url, serviceKey, { ...session, state: "handoff", ai_enabled: false }, "Website chat needs a person", `${session.visitor_name || "A website visitor"} requested a human response.`, websiteChatCrmHref(leadId));
    }
    return json({ state: "handoff", aiEnabled: false, messages: await publicMessages(url, serviceKey, session.conversation_id) }, 200, cors);
  }

  return json({ error: "That receptionist action is not supported." }, 400, cors);
};
