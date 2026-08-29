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

export interface ExistingFormspreeLeadContact {
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  service_interest?: unknown;
  message?: unknown;
}

function clean(value: unknown, maxLength: number) {
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizedFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function submissionValue(submission: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(submission, alias)) return submission[alias];
  }
  const aliasNames = new Set(aliases.map(normalizedFieldName));
  const matchingKey = Object.keys(submission).find((key) => aliasNames.has(normalizedFieldName(key)));
  return matchingKey ? submission[matchingKey] : undefined;
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
  const firstName = clean(submissionValue(submission, ["firstName", "first_name", "first"]), 90);
  const lastName = clean(submissionValue(submission, ["lastName", "last_name", "last"]), 90);
  const fullName = clean(submissionValue(submission, ["name", "fullName", "full_name", "contactName", "contact_name", "yourName"]), 180)
    || [firstName, lastName].filter(Boolean).join(" ");
  const company = clean(submissionValue(submission, ["businessName", "business_name", "company", "companyName", "organization"]), 180);
  const contactMethod = clean(submissionValue(submission, ["contactMethod", "contact_method", "preferredContact", "preferred_contact"]), 80);
  const description = clean(submissionValue(submission, ["description", "message", "comments", "projectDescription", "inquiry"]), 4000);
  const submittedValue = clean(submissionValue(submission, ["_date", "submittedAt", "submitted_at"]), 100);
  const submittedDate = submittedValue ? new Date(submittedValue) : null;
  const submittedAt = submittedDate && !Number.isNaN(submittedDate.getTime()) ? submittedDate.toISOString() : null;
  const contactNote = contactMethod ? `Preferred contact: ${contactMethod}.` : "";
  return {
    fullName: fullName || company,
    email: clean(submissionValue(submission, ["email", "emailAddress", "email_address", "contactEmail", "contact_email", "yourEmail", "_replyto", "replyTo", "reply_to"]), 320).toLowerCase(),
    phone: clean(submissionValue(submission, ["phone", "phoneNumber", "phone_number", "telephone", "mobile"]), 60),
    company,
    serviceInterest: clean(submissionValue(submission, ["service", "serviceInterest", "service_interest", "requestedService", "requested_service"]), 240),
    message: [description, contactNote].filter(Boolean).join("\n\n"),
    contactMethod,
    submittedAt,
    sourceUrl: clean(submissionValue(submission, ["_url", "sourceUrl", "source_url"]), 1000),
    isSpam: Boolean(clean(submissionValue(submission, ["_gotcha"]), 500)),
  };
}

export function missingFormspreeLeadContact(existing: ExistingFormspreeLeadContact, incoming: FormspreeLead) {
  const patch: Record<string, string> = {};
  if (!clean(existing.email, 320) && incoming.email) patch.email = incoming.email;
  if (!clean(existing.phone, 60) && incoming.phone) patch.phone = incoming.phone;
  if (!clean(existing.company, 180) && incoming.company) patch.company = incoming.company;
  if (!clean(existing.service_interest, 240) && incoming.serviceInterest) patch.service_interest = incoming.serviceInterest;
  if (!clean(existing.message, 4000) && incoming.message) patch.message = incoming.message;
  return patch;
}
