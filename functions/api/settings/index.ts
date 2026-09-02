import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";
import { isValidEmail, normalizeEmail } from "../../../lib/email";

interface Env extends FunctionEnv {}

const allowedTimezones = new Set(["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York"]);
const allowedCadences = new Set(["Weekly", "Monthly", "Quarterly"]);

function headers(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeSettings(input: unknown) {
  const root = object(input);
  const preferences = object(root.preferences);
  const security = object(root.security);
  const communications = object(root.communications);
  const email = normalizeEmail(preferences.email);
  if (!isValidEmail(email)) return null;
  const website = clean(preferences.website, 500);
  if (website) {
    try {
      const parsed = new URL(website);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    } catch {
      return null;
    }
  }
  const timezone = clean(preferences.timezone, 64);
  const cadence = clean(preferences.cadence, 32);
  if (!allowedTimezones.has(timezone) || !allowedCadences.has(cadence)) return null;
  return {
    preferences: {
      company: clean(preferences.company, 160),
      industry: clean(preferences.industry, 100),
      location: clean(preferences.location, 300),
      website,
      email,
      phone: clean(preferences.phone, 60),
      timezone,
      cadence,
      emailAlerts: preferences.emailAlerts !== false,
      weeklyDigest: preferences.weeklyDigest !== false,
      explanations: preferences.explanations !== false,
    },
    security: {
      mfa: security.mfa !== false,
      customerEdit: security.customerEdit !== false,
      audit: security.audit !== false,
      backups: security.backups !== false,
    },
    communications: {
      autoLeadAcknowledgment: communications.autoLeadAcknowledgment !== false,
      websiteChatEnabled: communications.websiteChatEnabled !== false,
    },
    compact: root.compact === true,
    completed: Array.isArray(root.completed) ? root.completed.slice(0, 4).map(Boolean) : [],
  };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env);
  if ("response" in auth) return auth.response;
  const organizationId = auth.context.organizationId || "";
  if (!organizationId) return authJson({ error: "Open an organization workspace before loading settings." }, 409);
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const [organizationResponse, preferenceResponse] = await Promise.all([
    fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=settings&limit=1`, { headers: headers(serviceKey) }),
    fetch(`${url}/rest/v1/user_preferences?user_id=eq.${encodeURIComponent(auth.context.userId)}&organization_id=eq.${encodeURIComponent(organizationId)}&preference_key=eq.admin-settings&select=value&limit=1`, { headers: headers(serviceKey) }),
  ]);
  if (!organizationResponse.ok || !preferenceResponse.ok) return authJson({ error: "Settings storage is not ready in Supabase." }, 503);
  const organizations = await organizationResponse.json().catch(() => []) as Array<{ settings?: Record<string, unknown> }>;
  const preferences = await preferenceResponse.json().catch(() => []) as Array<{ value?: Record<string, unknown> }>;
  const organizationSettings = object(organizations[0]?.settings);
  const saved = object(preferences[0]?.value);
  const savedPreferences = object(saved.preferences);
  const contact = object(organizationSettings.contact);
  const organizationCommunications = object(organizationSettings.communications);
  return authJson({
    settings: {
      ...saved,
      preferences: {
        ...savedPreferences,
        company: contact.company ?? savedPreferences.company,
        industry: contact.industry ?? savedPreferences.industry,
        location: contact.location ?? savedPreferences.location,
        website: contact.website ?? savedPreferences.website,
        email: contact.email ?? savedPreferences.email,
        phone: contact.phone ?? savedPreferences.phone,
      },
      communications: {
        autoLeadAcknowledgment: organizationCommunications.autoLeadAcknowledgment !== false,
        websiteChatEnabled: organizationCommunications.websiteChatEnabled !== false,
      },
    },
  });
};

export const onRequestPatch = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env, { permission: "organization.manage" });
  if ("response" in auth) return auth.response;
  const organizationId = auth.context.organizationId || "";
  if (!organizationId) return authJson({ error: "Open an organization workspace before saving settings." }, 409);
  const settings = normalizeSettings(await request.json().catch(() => null));
  if (!settings || !settings.preferences.company || !settings.preferences.industry) {
    return authJson({ error: "Add a company name, industry, valid contact email, and valid website before saving." }, 400);
  }

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=settings&limit=1`, { headers: headers(serviceKey) });
  const organizationRows = await organizationResponse.json().catch(() => []) as Array<{ settings?: Record<string, unknown> }>;
  if (!organizationResponse.ok || !organizationRows[0]) return authJson({ error: "The organization settings could not be loaded." }, 502);
  const currentSettings = object(organizationRows[0].settings);
  const currentContact = object(currentSettings.contact);
  const emailChanged = normalizeEmail(currentContact.email) !== settings.preferences.email;
  const nextOrganizationSettings = {
    ...currentSettings,
    contact: {
      company: settings.preferences.company,
      industry: settings.preferences.industry,
      location: settings.preferences.location,
      website: settings.preferences.website,
      email: settings.preferences.email,
      phone: settings.preferences.phone,
    },
    communications: settings.communications,
  };
  const now = new Date().toISOString();
  const [organizationWrite, preferenceWrite] = await Promise.all([
    fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}`, {
      method: "PATCH",
      headers: headers(serviceKey, "return=minimal"),
      body: JSON.stringify({ settings: nextOrganizationSettings, updated_at: now }),
    }),
    fetch(`${url}/rest/v1/user_preferences?on_conflict=user_id,organization_id,preference_key`, {
      method: "POST",
      headers: headers(serviceKey, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify({ user_id: auth.context.userId, organization_id: organizationId, preference_key: "admin-settings", value: settings, updated_at: now }),
    }),
  ]);
  if (!organizationWrite.ok || !preferenceWrite.ok) return authJson({ error: "Supabase could not confirm the settings update." }, 502);

  await fetch(`${url}/rest/v1/audit_events`, {
    method: "POST",
    headers: headers(serviceKey, "return=minimal"),
    body: JSON.stringify({
      organization_id: organizationId,
      actor_user_id: auth.context.userId,
      action: emailChanged ? "organization.contact_email.updated" : "organization.settings.updated",
      entity_type: "organization",
      entity_id: organizationId,
      metadata: { email_changed: emailChanged, settings_scope: ["contact", "preferences", "security", "communications"] },
    }),
  });
  return authJson({ settings, message: emailChanged ? "Admin contact email saved to Supabase." : "Admin settings saved to Supabase." });
};
