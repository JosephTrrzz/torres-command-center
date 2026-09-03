import type { AuthSession } from "./types";
import type { IntegrationProvider, IntegrationsSnapshot } from "./integrations";

type IntegrationsResponse = { snapshot?: IntegrationsSnapshot; message?: string; error?: string };

function headers(session: AuthSession) {
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

async function parse(response: Response) {
  const payload = await response.json().catch(() => ({})) as IntegrationsResponse;
  if (!response.ok) throw new Error(payload.error || "The integration control center could not be loaded.");
  return payload;
}

export async function fetchIntegrations(session: AuthSession, clientId: string) {
  const response = await fetch(`/api/integrations/?client=${encodeURIComponent(clientId)}`, {
    headers: headers(session),
    cache: "no-store",
  });
  const payload = await parse(response);
  if (!payload.snapshot) throw new Error("The integration control center returned an incomplete response.");
  return payload.snapshot;
}

export async function checkIntegration(session: AuthSession, clientId: string, provider: IntegrationProvider) {
  return parse(await fetch("/api/integrations/", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "check", clientId, provider }),
  }));
}

export async function syncIntegration(session: AuthSession, clientId: string, provider: IntegrationProvider) {
  return parse(await fetch("/api/integrations/", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "sync", clientId, provider }),
  }));
}

export async function disconnectIntegration(session: AuthSession, clientId: string, provider: IntegrationProvider) {
  return parse(await fetch("/api/integrations/", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ action: "disconnect", clientId, provider, confirmation: "DISCONNECT" }),
  }));
}
