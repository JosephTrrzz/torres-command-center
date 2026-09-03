import type { ScheduleEvent } from "./schedule";
import type { AuthSession } from "./types";

export interface ScheduleClient {
  id: string;
  name: string;
  industry: string;
  location: string;
}

export async function fetchSchedule(session: AuthSession) {
  const response = await fetch("/api/schedule/", { headers: { Authorization: `Bearer ${session.access_token}` } });
  const body = await response.json().catch(() => ({})) as { clients?: ScheduleClient[]; events?: ScheduleEvent[]; canManage?: boolean; error?: string };
  if (!response.ok || !Array.isArray(body.clients) || !Array.isArray(body.events)) throw new Error(body.error || "The agency schedule could not be loaded.");
  return { clients: body.clients, events: body.events, canManage: body.canManage === true };
}
