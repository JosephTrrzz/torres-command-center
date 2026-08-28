export interface TwilioEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_PHONE_NUMBER?: string;
  PUBLIC_APP_URL?: string;
}

const e164Pattern = /^\+[1-9]\d{7,14}$/;

export function normalizeE164(value: unknown) {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[\s().-]/g, "");
  const normalized = compact.startsWith("+") ? compact : compact.length === 10 ? `+1${compact}` : compact;
  return e164Pattern.test(normalized) ? normalized : "";
}

export function twilioSmsConfigured(env: TwilioEnv) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID?.startsWith("AC")
    && env.TWILIO_AUTH_TOKEN
    && (env.TWILIO_MESSAGING_SERVICE_SID?.startsWith("MG") || normalizeE164(env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER)),
  );
}

export function twilioVoiceConfigured(env: TwilioEnv) {
  return Boolean(env.TWILIO_ACCOUNT_SID?.startsWith("AC") && env.TWILIO_AUTH_TOKEN && normalizeE164(env.TWILIO_PHONE_NUMBER || env.TWILIO_FROM_NUMBER));
}

export function twilioMessageStatus(value: unknown) {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "delivered" || status === "read") return "delivered";
  if (["failed", "undelivered", "canceled"].includes(status)) return "failed";
  if (["sent", "sending"].includes(status)) return "sent";
  return "queued";
}

export async function sendTwilioSms(env: TwilioEnv, input: { to: string; body: string; statusCallback?: string }) {
  if (!twilioSmsConfigured(env)) throw new Error("Twilio SMS is not configured.");
  const to = normalizeE164(input.to);
  if (!to) throw new Error("Use a valid mobile number including the country code.");
  const form = new URLSearchParams({ To: to, Body: input.body });
  const from = normalizeE164(env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER);
  if (env.TWILIO_MESSAGING_SERVICE_SID?.startsWith("MG")) form.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
  else if (from) form.set("From", from);
  if (input.statusCallback) form.set("StatusCallback", input.statusCallback);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID || "")}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({})) as { sid?: string; status?: string; error_message?: string; message?: string };
  if (!response.ok || !payload.sid) throw new Error(payload.error_message || payload.message || "Twilio rejected the SMS request.");
  return { id: payload.sid, status: twilioMessageStatus(payload.status) };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export async function verifyTwilioSignature(authToken: string, requestUrl: string, params: URLSearchParams, signature: string) {
  if (!authToken || !signature) return false;
  const canonical = Array.from(params.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const payload = canonical.reduce((value, [key, entry]) => `${value}${key}${entry}`, requestUrl);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const expected = bytesToBase64(digest);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}
