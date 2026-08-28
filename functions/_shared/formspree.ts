export interface FormspreeEnv {
  FORMSPREE_WEBHOOK_SECRET?: string;
  FORMSPREE_CLIENT_ID?: string;
  FORMSPREE_FORM_ID?: string;
}

export interface FormspreePayload {
  form?: unknown;
  keys?: unknown;
  submission?: Record<string, unknown>;
}

export interface FormspreeLead {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  serviceInterest: string;
  message: string;
  contactMethod: string;
  submittedAt: string | null;
  sourceUrl: string;
  isSpam: boolean;
}

function clean(value: unknown, maxLength: number) {
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function configured(value: string | undefined) {
  const normalized = value?.trim() || "";
  return Boolean(normalized && !/^(optional|replace-|your-)/i.test(normalized));
}

function fromHex(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export function formspreeConfigured(env: FormspreeEnv) {
  return configured(env.FORMSPREE_WEBHOOK_SECRET)
    && configured(env.FORMSPREE_CLIENT_ID)
    && configured(env.FORMSPREE_FORM_ID);
}

export function matchesFormspreeForm(received: unknown, expected: string | undefined) {
  const receivedValue = clean(received, 500);
  const expectedValue = clean(expected, 500);
  if (!receivedValue || !expectedValue) return false;
  if (receivedValue === expectedValue) return true;
  try {
    const receivedUrl = new URL(receivedValue);
    return receivedUrl.pathname.split("/").filter(Boolean).at(-1) === expectedValue;
  } catch {
    return receivedValue.split("/").filter(Boolean).at(-1) === expectedValue;
  }
}

export async function verifyFormspreeWebhook(
  env: FormspreeEnv,
  payload: string,
  signatureHeader: string | null,
  now = Date.now(),
) {
  const secret = env.FORMSPREE_WEBHOOK_SECRET?.trim() || "";
  if (!configured(secret) || !signatureHeader) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [name, ...valueParts] = part.trim().split("=");
    const value = valueParts.join("=").trim();
    if (name === "t") timestamp = value;
    if (name === "v1" && value) signatures.push(value);
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(now - timestampSeconds * 1000) > 5 * 60 * 1000 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => {
    const candidate = fromHex(signature);
    return candidate ? constantTimeEqual(expected, candidate) : false;
  });
}

export async function formspreeSubmissionFingerprint(payload: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function mapFormspreeLead(payload: FormspreePayload): FormspreeLead {
  const submission = payload.submission && typeof payload.submission === "object" ? payload.submission : {};
  const fullName = clean(submission.name ?? submission.fullName ?? submission.full_name, 180);
  const company = clean(submission.businessName ?? submission.company ?? submission.business_name, 180);
  const contactMethod = clean(submission.contactMethod ?? submission.contact_method, 80);
  const description = clean(submission.description ?? submission.message, 4000);
  const submittedValue = clean(submission._date ?? submission.submittedAt ?? submission.submitted_at, 100);
  const submittedDate = submittedValue ? new Date(submittedValue) : null;
  const submittedAt = submittedDate && !Number.isNaN(submittedDate.getTime()) ? submittedDate.toISOString() : null;
  const contactNote = contactMethod ? `Preferred contact: ${contactMethod}.` : "";
  return {
    fullName: fullName || company,
    email: clean(submission.email, 320).toLowerCase(),
    phone: clean(submission.phone, 60),
    company,
    serviceInterest: clean(submission.service ?? submission.serviceInterest ?? submission.service_interest, 240),
    message: [description, contactNote].filter(Boolean).join("\n\n"),
    contactMethod,
    submittedAt,
    sourceUrl: clean(submission._url ?? submission.sourceUrl ?? submission.source_url, 1000),
    isSpam: Boolean(clean(submission._gotcha, 500)),
  };
}
