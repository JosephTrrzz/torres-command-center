import { getSupabaseUrl, type FunctionEnv } from "../../_shared/auth";
import { normalizeE164, twilioMessageStatus, verifyTwilioSignature, type TwilioEnv } from "../../_shared/twilio";

interface Env extends FunctionEnv, TwilioEnv {}

type ConsentMatch = { organization_id: string; client_id: string; address: string; status: string };
type MessageMatch = { id: string; conversation_id: string; client_id: string; organization_id: string };

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function twiml(body = "") {
  const escaped = body.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${escaped ? `<Message>${escaped}</Message>` : ""}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function parseVerifiedRequest(request: Request, env: Env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) return null;
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const publicBase = (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const verificationUrl = `${publicBase}${new URL(request.url).pathname}${new URL(request.url).search}`;
  const valid = await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN || "", verificationUrl, params, request.headers.get("x-twilio-signature") || "");
  return valid ? params : null;
}

async function consentForAddress(url: string, serviceKey: string, address: string) {
  const response = await fetch(`${url}/rest/v1/communication_consents?channel=eq.sms&address=eq.${encodeURIComponent(address)}&select=organization_id,client_id,address,status&order=updated_at.desc&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as ConsentMatch[] : [];
  return rows[0] || null;
}

async function messageForProviderId(url: string, serviceKey: string, providerId: string) {
  const response = await fetch(`${url}/rest/v1/messages?provider_message_id=eq.${encodeURIComponent(providerId)}&channel=eq.sms&select=id,conversation_id,client_id,organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as MessageMatch[] : [];
  return rows[0] || null;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey || !env.TWILIO_AUTH_TOKEN) return new Response("Webhook is not configured.", { status: 503 });
  const params = await parseVerifiedRequest(request, env);
  if (!params) return new Response("Invalid webhook signature.", { status: 401 });

  const providerMessageId = params.get("MessageSid") || params.get("SmsSid") || "";
  const fromAddress = normalizeE164(params.get("From"));
  const toAddress = normalizeE164(params.get("To"));
  const body = (params.get("Body") || "").trim().slice(0, 8000);
  const rawStatus = params.get("MessageStatus") || params.get("SmsStatus") || "";
  const now = new Date().toISOString();

  if (rawStatus && providerMessageId) {
    const message = await messageForProviderId(url, serviceKey, providerMessageId);
    if (!message) return twiml();
    const status = twilioMessageStatus(rawStatus);
    const errorDetail = [params.get("ErrorCode"), params.get("ErrorMessage")].filter(Boolean).join(": ").slice(0, 500);
    await Promise.allSettled([
      fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(message.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, error_detail: errorDetail }) }),
      fetch(`${url}/rest/v1/sms_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: message.organization_id, client_id: message.client_id, conversation_id: message.conversation_id, message_id: message.id, provider: "twilio", provider_message_id: providerMessageId, direction: "outbound", event_type: `status:${rawStatus}`, status, from_address: fromAddress, to_address: toAddress, error_detail: errorDetail, occurred_at: now }) }),
    ]);
    return twiml();
  }

  if (!fromAddress || !toAddress || !body) return twiml();
  const consent = await consentForAddress(url, serviceKey, fromAddress);
  // Unknown numbers receive no automated reply. This avoids creating an
  // unconsented outbound message or confirming that a number is on file.
  if (!consent) return twiml();
  const keyword = body.toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
    await Promise.allSettled([
      fetch(`${url}/rest/v1/communication_consents?organization_id=eq.${encodeURIComponent(consent.organization_id)}&client_id=eq.${encodeURIComponent(consent.client_id)}&channel=eq.sms&address=eq.${encodeURIComponent(fromAddress)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "revoked", source: "provider_keyword", revoked_at: now, updated_at: now }) }),
      fetch(`${url}/rest/v1/communication_suppressions?on_conflict=organization_id,channel,address`, { method: "POST", headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"), body: JSON.stringify({ organization_id: consent.organization_id, client_id: consent.client_id, channel: "sms", address: fromAddress, reason: "recipient_opt_out", source: "provider_keyword", active: true, updated_at: now }) }),
    ]);
    return twiml();
  }
  if (["START", "UNSTOP", "YES"].includes(keyword)) {
    await Promise.allSettled([
      fetch(`${url}/rest/v1/communication_consents?organization_id=eq.${encodeURIComponent(consent.organization_id)}&client_id=eq.${encodeURIComponent(consent.client_id)}&channel=eq.sms&address=eq.${encodeURIComponent(fromAddress)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "granted", source: "provider_keyword", evidence: `Recipient replied ${keyword}`, granted_at: now, revoked_at: null, updated_at: now }) }),
      fetch(`${url}/rest/v1/communication_suppressions?organization_id=eq.${encodeURIComponent(consent.organization_id)}&channel=eq.sms&address=eq.${encodeURIComponent(fromAddress)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ active: false, updated_at: now }) }),
    ]);
  }

  const subject = `SMS from ${fromAddress}`;
  const conversationResponse = await fetch(`${url}/rest/v1/conversations`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: consent.organization_id, client_id: consent.client_id, subject, channel: "sms", status: "open", priority: "normal", category: "support", client_visible: false, last_message_at: now }) });
  const conversations = conversationResponse.ok ? await conversationResponse.json().catch(() => []) as Array<{ id?: string }> : [];
  if (!conversations[0]?.id) return twiml();
  const messageResponse = await fetch(`${url}/rest/v1/messages`, { method: "POST", headers: serviceHeaders(serviceKey, "return=representation"), body: JSON.stringify({ organization_id: consent.organization_id, client_id: consent.client_id, conversation_id: conversations[0].id, direction: "inbound", channel: "sms", status: "received", sender_name: fromAddress, sender_address: fromAddress, recipients: [toAddress], subject, body, provider_message_id: providerMessageId, client_visible: false, sent_at: now }) });
  const messages = messageResponse.ok ? await messageResponse.json().catch(() => []) as Array<{ id?: string }> : [];
  await fetch(`${url}/rest/v1/sms_events`, { method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: consent.organization_id, client_id: consent.client_id, conversation_id: conversations[0].id, message_id: messages[0]?.id || null, provider: "twilio", provider_message_id: providerMessageId, direction: "inbound", event_type: "received", status: "received", from_address: fromAddress, to_address: toAddress, occurred_at: now }) });
  return twiml();
};
