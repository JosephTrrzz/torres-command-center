import type { AuthSession } from "./types";
import type { CrmSnapshot } from "./crm";

type CrmResponse = { snapshot?: CrmSnapshot; message?: string; error?: string };

async function requestCrm(session: AuthSession, path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as CrmResponse;
  if (!response.ok || !body.snapshot) throw new Error(body.error || "CRM information could not be loaded.");
  return body;
}

export async function fetchCrm(session: AuthSession, clientId: string) {
  return (await requestCrm(session, `/api/crm/?client=${encodeURIComponent(clientId)}`)).snapshot as CrmSnapshot;
}

export async function changeCrm(session: AuthSession, input: Record<string, unknown>) {
  return requestCrm(session, "/api/crm/", { method: "POST", body: JSON.stringify(input) });
}
