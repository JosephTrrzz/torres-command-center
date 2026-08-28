import {
  deliveryStatusForResendEvent,
  verifyResendWebhook,
  type EmailEnv,
  type ResendDeliveryStatus,
} from "../../_shared/email";
import { getSupabaseUrl, type FunctionEnv } from "../../_shared/auth";

interface Env extends FunctionEnv, EmailEnv {}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    error?: { message?: string };
    bounce?: { message?: string };
    suppressed?: { message?: string };
    [key: string]: unknown;
  };
}

interface DeliveryRow {
  id: string;
  message_id: string | null;
  status: ResendDeliveryStatus | "queued";
}

interface MarketingRecipientRow { organization_id: string; email: string }

const statusRank: Record<DeliveryRow["status"], number> = {
  queued: 0,
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  failed: 4,
  bounced: 4,
  complained: 4,
  suppressed: 4,
};

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function response(status = 200) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function failureDetail(event: ResendEvent) {
  const value = event.data?.error?.message || event.data?.bounce?.message || event.data?.suppressed?.message || "";
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const payload = await request.text();
  if (!await verifyResendWebhook(env, payload, request.headers)) return response(401);
  const eventId = request.headers.get("svix-id") || "";
  let event: ResendEvent;
  try {
    event = JSON.parse(payload) as ResendEvent;
  } catch {
    return response(400);
  }
  const nextStatus = deliveryStatusForResendEvent(event.type || "");
  const providerMessageId = typeof event.data?.email_id === "string" ? event.data.email_id.trim() : "";
  if (!nextStatus || !providerMessageId) return response();
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return response(503);

  const duplicateResponse = await fetch(`${url}/rest/v1/email_delivery_events?provider_event_id=eq.${encodeURIComponent(eventId)}&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const duplicateRows = duplicateResponse.ok ? await duplicateResponse.json().catch(() => []) as Array<{ id?: string }> : [];
  if (duplicateRows[0]?.id) return response();

  const deliveryResponse = await fetch(`${url}/rest/v1/email_deliveries?provider_message_id=eq.${encodeURIComponent(providerMessageId)}&select=id,message_id,status&limit=1`, { headers: serviceHeaders(serviceKey) });
  const deliveryRows = deliveryResponse.ok ? await deliveryResponse.json().catch(() => []) as DeliveryRow[] : [];
  const delivery = deliveryRows[0];
  if (!delivery) return response();
  const occurredAt = event.created_at && !Number.isNaN(Date.parse(event.created_at)) ? new Date(event.created_at).toISOString() : new Date().toISOString();
  const eventResponse = await fetch(`${url}/rest/v1/email_delivery_events`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify({ delivery_id: delivery.id, provider_event_id: eventId, event_type: event.type || "", occurred_at: occurredAt, payload: event }),
  });
  if (!eventResponse.ok && eventResponse.status !== 409) return response(500);
  if (statusRank[nextStatus] < statusRank[delivery.status]) return response();

  const detail = failureDetail(event);
  const terminalFailure = ["failed", "bounced", "complained", "suppressed"].includes(nextStatus);
  const deliveryPatch = {
    status: nextStatus,
    error_detail: terminalFailure ? detail || nextStatus.replaceAll("_", " ") : "",
    ...(nextStatus === "delivered" ? { delivered_at: occurredAt } : {}),
    updated_at: new Date().toISOString(),
  };
  await fetch(`${url}/rest/v1/email_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
    method: "PATCH",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify(deliveryPatch),
  });
  const marketingPatch = {
    status: nextStatus,
    provider_message_id: providerMessageId,
    error_detail: terminalFailure ? deliveryPatch.error_detail : "",
    ...(nextStatus === "delivered" ? { delivered_at: occurredAt } : {}),
    updated_at: new Date().toISOString(),
  };
  await fetch(`${url}/rest/v1/marketing_campaign_recipients?email_delivery_id=eq.${encodeURIComponent(delivery.id)}`, {
    method: "PATCH",
    headers: serviceHeaders(serviceKey, "return=minimal"),
    body: JSON.stringify(marketingPatch),
  });
  if (["bounced", "complained", "suppressed"].includes(nextStatus)) {
    const recipientResponse = await fetch(`${url}/rest/v1/marketing_campaign_recipients?email_delivery_id=eq.${encodeURIComponent(delivery.id)}&select=organization_id,email&limit=1`, { headers: serviceHeaders(serviceKey) });
    const recipients = recipientResponse.ok ? await recipientResponse.json().catch(() => []) as MarketingRecipientRow[] : [];
    const recipient = recipients[0];
    if (recipient) {
      await fetch(`${url}/rest/v1/marketing_suppressions?on_conflict=organization_id,email`, {
        method: "POST",
        headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"),
        body: JSON.stringify({ organization_id: recipient.organization_id, email: recipient.email.toLowerCase(), reason: nextStatus === "bounced" ? "bounced" : nextStatus === "complained" ? "complained" : "provider_suppressed", source: "resend_webhook", detail: detail || nextStatus, updated_at: occurredAt }),
      });
    }
  }
  if (delivery.message_id) {
    await fetch(`${url}/rest/v1/messages?id=eq.${encodeURIComponent(delivery.message_id)}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({
        status: nextStatus === "delivered" ? "delivered" : terminalFailure ? "failed" : "sent",
        error_detail: terminalFailure ? deliveryPatch.error_detail : "",
      }),
    });
  }
  return response();
};
