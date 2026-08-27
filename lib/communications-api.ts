import type { CommunicationsSnapshot } from "./communications";
import type { AuthSession } from "./types";

function headers(session: AuthSession) {
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; snapshot?: CommunicationsSnapshot };
  if (!response.ok) throw new Error(payload.error || "The communications workspace could not be loaded.");
  return payload;
}

export async function fetchCommunications(session: AuthSession, clientId?: string) {
  const query = clientId ? `?client=${encodeURIComponent(clientId)}` : "";
  const response = await fetch(`/api/communications${query}`, { headers: headers(session), cache: "no-store" });
  const payload = await parseResponse(response);
  if (!payload.snapshot) throw new Error("The communications workspace returned an incomplete response.");
  return payload.snapshot;
}

export async function changeCommunications(session: AuthSession, input: Record<string, unknown>) {
  const response = await fetch("/api/communications", { method: "POST", headers: headers(session), body: JSON.stringify(input) });
  return parseResponse(response);
}
