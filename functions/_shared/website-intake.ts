export interface WebsiteIntakeEnv {
  WEBSITE_INTAKE_SECRET?: string;
  WEBSITE_LEADS_CLIENT_ID?: string;
}

function configured(value: string | undefined) {
  const normalized = value?.trim() || "";
  return Boolean(normalized && !/^(optional|replace-|your-)/i.test(normalized));
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export function websiteIntakeConfigured(env: WebsiteIntakeEnv) {
  return configured(env.WEBSITE_INTAKE_SECRET) && configured(env.WEBSITE_LEADS_CLIENT_ID);
}

export async function verifyWebsiteIntakeSecret(env: WebsiteIntakeEnv, received: string | null) {
  const expected = env.WEBSITE_INTAKE_SECRET?.trim() || "";
  if (!configured(expected) || !received) return false;
  return constantTimeEqual(await digest(expected), await digest(received.trim()));
}

export function validWebsiteSubmissionId(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
