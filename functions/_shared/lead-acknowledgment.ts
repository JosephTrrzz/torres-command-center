import { buildTransactionalEmailHtml, type EmailEnv } from "./email";
import { readCommunicationSettings } from "./communications-settings";
import { sendTrackedEmail, type TrackedEmailResult } from "./tracked-email";
import type { FunctionEnv } from "./auth";

interface LeadAcknowledgmentInput {
  supabaseUrl: string;
  serviceKey: string;
  organizationId: string;
  clientId: string;
  leadId: string;
  fullName: string;
  email: string;
}

export async function sendLeadAcknowledgment(
  env: FunctionEnv & EmailEnv,
  input: LeadAcknowledgmentInput,
): Promise<TrackedEmailResult | { sent: false; status: "skipped" }> {
  if (!input.email) return { sent: false, status: "skipped" };
  const settings = await readCommunicationSettings(input.supabaseUrl, input.serviceKey, input.organizationId);
  if (!settings.autoLeadAcknowledgment) return { sent: false, status: "skipped" };

  const firstName = input.fullName.trim().split(/\s+/)[0] || "there";
  const subject = "We received your message";
  const text = `Hi ${firstName},\n\nWe received your message. A member of the Torres & Co. Technology team will respond within 24 hours.\n\nIf you need to add context, reply directly to this email.`;
  return sendTrackedEmail(env, {
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    organizationId: input.organizationId,
    clientId: input.clientId,
    recipient: input.email,
    subject,
    text,
    html: buildTransactionalEmailHtml({ heading: subject, body: text }),
    templateKey: "lead_acknowledgment",
    idempotencyKey: `lead-ack:${input.leadId}`,
    replyTo: env.TRANSACTIONAL_EMAIL_REPLY_TO,
  });
}
