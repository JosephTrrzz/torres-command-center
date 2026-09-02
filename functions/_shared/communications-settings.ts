export interface CommunicationSettings {
  autoLeadAcknowledgment: boolean;
  websiteChatEnabled: boolean;
}

const defaults: CommunicationSettings = {
  autoLeadAcknowledgment: true,
  websiteChatEnabled: true,
};

const headers = (serviceKey: string) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
});

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalize(settings: unknown): CommunicationSettings {
  const communications = object(object(settings).communications);
  return {
    autoLeadAcknowledgment: communications.autoLeadAcknowledgment !== false,
    websiteChatEnabled: communications.websiteChatEnabled !== false,
  };
}

export async function readCommunicationSettings(
  supabaseUrl: string,
  serviceKey: string,
  organizationId: string,
): Promise<CommunicationSettings> {
  if (!organizationId) return defaults;
  const response = await fetch(`${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=settings,parent_organization_id&limit=1`, {
    headers: headers(serviceKey),
  });
  const rows = response.ok
    ? await response.json().catch(() => []) as Array<{ settings?: unknown; parent_organization_id?: string | null }>
    : [];
  const organization = rows[0];
  if (!organization) return defaults;
  if (!organization.parent_organization_id) return normalize(organization.settings);

  const parentResponse = await fetch(`${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(organization.parent_organization_id)}&select=settings&limit=1`, {
    headers: headers(serviceKey),
  });
  const parents = parentResponse.ok
    ? await parentResponse.json().catch(() => []) as Array<{ settings?: unknown }>
    : [];
  return parents[0] ? normalize(parents[0].settings) : normalize(organization.settings);
}
