import { emailConfigured, sendTransactionalEmail, type EmailEnv } from "./email";

interface TrackedEmailInput {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  clientId?: string | null;
  recipient: string;
  subject: string;
  text: string;
  html: string;
  templateKey: string;
  idempotencyKey: string;
}

export interface TrackedEmailResult {
  sent: boolean;
  status: "sent" | "failed" | "not_configured";
  providerMessageId?: string;
  error?: string;
}

const headers = (serviceKey: string) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
});

export async function activationEmailKey(scope: string, actionLink: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actionLink));
  const fingerprint = Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${scope}:${fingerprint}`;
}

export async function sendTrackedEmail(env: EmailEnv, input: TrackedEmailInput): Promise<TrackedEmailResult> {
  if (!emailConfigured(env)) {
    return { sent: false, status: "not_configured", error: "Transactional email is not configured." };
  }

  const deliveryResponse = await fetch(`${input.supabaseUrl}/rest/v1/email_deliveries?on_conflict=idempotency_key`, {
    method: "POST",
    headers: { ...headers(input.serviceKey), Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      organization_id: input.organizationId,
      client_id: input.clientId || null,
      template_key: input.templateKey,
      recipients: [input.recipient],
      subject: input.subject,
      status: "queued",
      provider: "resend",
      idempotency_key: input.idempotencyKey,
    }),
  });
  if (!deliveryResponse.ok) {
    const detail = await deliveryResponse.text().catch(() => "");
    return { sent: false, status: "failed", error: detail.slice(0, 300) || "Email delivery history could not be created." };
  }

  let deliveries = await deliveryResponse.json().catch(() => []) as Array<{ id?: string; provider_message_id?: string | null; status?: string }>;
  if (!deliveries.length) {
    const existingResponse = await fetch(`${input.supabaseUrl}/rest/v1/email_deliveries?idempotency_key=eq.${encodeURIComponent(input.idempotencyKey)}&select=id,provider_message_id,status&limit=1`, { headers: headers(input.serviceKey) });
    deliveries = await existingResponse.json().catch(() => []) as typeof deliveries;
  }
  const delivery = deliveries[0];
  if (!delivery?.id) return { sent: false, status: "failed", error: "Email delivery history could not be resolved." };
  if (delivery.provider_message_id && ["sent", "delivered"].includes(delivery.status || "")) {
    return { sent: true, status: "sent", providerMessageId: delivery.provider_message_id };
  }

  try {
    const provider = await sendTransactionalEmail(env, {
      to: [input.recipient],
      subject: input.subject,
      text: input.text,
      html: input.html,
      idempotencyKey: input.idempotencyKey,
    });
    const now = new Date().toISOString();
    const update = await fetch(`${input.supabaseUrl}/rest/v1/email_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
      method: "PATCH",
      headers: { ...headers(input.serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify({ status: "sent", provider_message_id: provider.id, sent_at: now, error_detail: "", updated_at: now }),
    });
    if (!update.ok) {
      return {
        sent: true,
        status: "sent",
        providerMessageId: provider.id,
        error: "Resend accepted the email, but its delivery record could not be updated.",
      };
    }
    return { sent: true, status: "sent", providerMessageId: provider.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Email provider rejected the request.";
    await fetch(`${input.supabaseUrl}/rest/v1/email_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
      method: "PATCH",
      headers: { ...headers(input.serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", error_detail: detail, updated_at: new Date().toISOString() }),
    }).catch(() => undefined);
    return { sent: false, status: "failed", error: detail };
  }
}
