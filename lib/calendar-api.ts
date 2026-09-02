import type { AuthSession } from "./types";

export async function changeAppleCalendar(session: AuthSession, clientId: string, action: "create" | "revoke") {
  const response = await fetch("/api/calendar/apple", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ clientId, action }) });
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; subscriptionUrl?: string; httpsUrl?: string };
  if (!response.ok) throw new Error(payload.error || "Apple Calendar could not be updated.");
  return payload;
}
