import type { AuthSession } from "./types";
import type { MarketingSnapshot } from "./marketing";

type MarketingResponse = { snapshot?: MarketingSnapshot; message?: string; error?: string };

async function requestMarketing(session: AuthSession, path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as MarketingResponse;
  if (!response.ok) throw new Error(body.error || "The campaign workspace could not be loaded.");
  return body;
}

export async function fetchMarketing(session: AuthSession, clientId: string) {
  const response = await requestMarketing(session, `/api/campaigns/?client=${encodeURIComponent(clientId)}`);
  if (!response.snapshot) throw new Error("The campaign workspace returned an incomplete response.");
  return response.snapshot;
}

export async function changeMarketing(session: AuthSession, input: Record<string, unknown>) {
  return requestMarketing(session, "/api/campaigns/", { method: "POST", body: JSON.stringify(input) });
}
