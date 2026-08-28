export interface EmailEnv {
  RESEND_API_KEY?: string;
  TRANSACTIONAL_EMAIL_FROM?: string;
  TRANSACTIONAL_EMAIL_REPLY_TO?: string;
  RESEND_WEBHOOK_SECRET?: string;
}

export type ResendDeliveryStatus =
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "failed"
  | "bounced"
  | "complained"
  | "suppressed";

export interface TransactionalEmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export const TRANSACTIONAL_EMAIL_SIGNATURE = "Team at Torres & Co. Technology LLC";
export const TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE = "Confidentiality notice: This email and any attachments are intended only for the named recipient and may contain confidential information. If you are not the intended recipient, do not read, copy, use, disclose, or distribute it. Please notify the sender and permanently delete this email, its attachments, and all copies or records from your systems.";

const emailFooterMarker = "data-torres-email-footer";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function configured(value: string | undefined) {
  const normalized = value?.trim() || "";
  return Boolean(normalized && !/^(optional|replace-|your-)/i.test(normalized));
}

export function emailConfigured(env: EmailEnv) {
  return configured(env.RESEND_API_KEY) && configured(env.TRANSACTIONAL_EMAIL_FROM);
}

export function escapeEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function withTransactionalEmailFooter(text: string) {
  const normalized = text.trimEnd();
  if (normalized.includes(TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE)) return normalized;
  return `${normalized}\n\n${TRANSACTIONAL_EMAIL_SIGNATURE}\n\n${TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE}`;
}

export function withTransactionalEmailHtmlFooter(html: string) {
  if (html.includes(emailFooterMarker)) return html;
  const footer = `<div ${emailFooterMarker}="true" style="margin:28px 0 0;padding-top:20px;border-top:1px solid #ebe5da"><p style="margin:0 0 14px;color:#132238;font-size:14px;font-weight:700;line-height:1.5">${escapeEmailHtml(TRANSACTIONAL_EMAIL_SIGNATURE)}</p><p style="margin:0;color:#777;font-size:11px;line-height:1.55">${escapeEmailHtml(TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE)}</p></div>`;
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  return bodyClose >= 0 ? `${html.slice(0, bodyClose)}${footer}${html.slice(bodyClose)}` : `${html}${footer}`;
}

function safeActionUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildTransactionalEmailHtml(input: {
  heading: string;
  body: string;
  preheader?: string;
  action?: { label: string; url: string };
}) {
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px;color:#4f5458;font-size:16px;line-height:1.65;white-space:pre-line">${escapeEmailHtml(paragraph)}</p>`)
    .join("");
  const actionUrl = input.action ? safeActionUrl(input.action.url) : "";
  const action = input.action && actionUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 28px"><tr><td style="border-radius:10px;background:#132238"><a href="${escapeEmailHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${escapeEmailHtml(input.action.label)}</a></td></tr></table>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f1e8;font-family:Arial,sans-serif;color:#132238"><div style="display:none;max-height:0;overflow:hidden">${escapeEmailHtml(input.preheader || input.heading)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1e8;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #ded8cd;border-radius:18px"><tr><td style="padding:30px"><p style="margin:0 0 24px;color:#9a7335;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Torres &amp; Co. Technology</p><h1 style="margin:0 0 20px;color:#132238;font-size:28px;line-height:1.2">${escapeEmailHtml(input.heading)}</h1>${paragraphs}${action}<div ${emailFooterMarker}="true" style="margin:28px 0 0;padding-top:20px;border-top:1px solid #ebe5da"><p style="margin:0 0 14px;color:#132238;font-size:14px;font-weight:700;line-height:1.5">${escapeEmailHtml(TRANSACTIONAL_EMAIL_SIGNATURE)}</p><p style="margin:0;color:#777;font-size:11px;line-height:1.55">${escapeEmailHtml(TRANSACTIONAL_EMAIL_CONFIDENTIALITY_NOTICE)}</p></div></td></tr></table></td></tr></table></body></html>`;
}

export async function sendTransactionalEmail(env: EmailEnv, input: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  replyTo?: string;
  attachments?: TransactionalEmailAttachment[];
}) {
  if (!emailConfigured(env)) throw new Error("Transactional email is not configured.");
  const to = input.to.map((address) => address.trim().toLowerCase()).filter(Boolean).slice(0, 25);
  if (!to.length || to.some((address) => !emailPattern.test(address))) throw new Error("Use a valid recipient email address.");
  const replyTo = (input.replyTo || env.TRANSACTIONAL_EMAIL_REPLY_TO || "").trim();
  if (replyTo && !emailPattern.test(replyTo)) throw new Error("The configured reply-to address is invalid.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY?.trim()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({
      from: env.TRANSACTIONAL_EMAIL_FROM?.trim(),
      to,
      subject: input.subject.trim().slice(0, 998),
      text: withTransactionalEmailFooter(input.text),
      html: withTransactionalEmailHtmlFooter(input.html || buildTransactionalEmailHtml({ heading: input.subject, body: input.text })),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments.map((attachment) => ({ filename: attachment.filename, content: attachment.content, ...(attachment.contentType ? { content_type: attachment.contentType } : {}) })) } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: unknown; message?: unknown; name?: unknown };
  if (!response.ok || typeof payload.id !== "string" || !payload.id.trim()) {
    const detail = typeof payload.message === "string" ? payload.message : typeof payload.name === "string" ? payload.name : "Email provider rejected the request.";
    throw new Error(detail.slice(0, 500));
  }
  return { id: payload.id.trim() };
}

export function deliveryStatusForResendEvent(eventType: string): ResendDeliveryStatus | null {
  const value = eventType.startsWith("email.") ? eventType.slice(6) : eventType;
  return ["sent", "delivered", "delivery_delayed", "failed", "bounced", "complained", "suppressed"].includes(value)
    ? value as ResendDeliveryStatus
    : null;
}

function decodeWebhookSecret(secret: string) {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    return new TextEncoder().encode(secret);
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export async function verifyResendWebhook(env: EmailEnv, payload: string, headers: Headers, now = Date.now()) {
  const secret = env.RESEND_WEBHOOK_SECRET?.trim() || "";
  const eventId = headers.get("svix-id") || "";
  const timestamp = headers.get("svix-timestamp") || "";
  const signatureHeader = headers.get("svix-signature") || "";
  const timestampSeconds = Number(timestamp);
  if (!configured(secret) || !eventId || !Number.isFinite(timestampSeconds) || Math.abs(now - timestampSeconds * 1000) > 5 * 60 * 1000) return false;
  const key = await crypto.subtle.importKey("raw", decodeWebhookSecret(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${eventId}.${timestamp}.${payload}`)));
  return signatureHeader.split(" ").some((candidate) => {
    const encoded = candidate.startsWith("v1,") ? candidate.slice(3) : "";
    if (!encoded) return false;
    try {
      return constantTimeEqual(digest, Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    } catch {
      return false;
    }
  });
}
