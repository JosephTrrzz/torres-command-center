import type { AuthSession } from "./types";

export type NotificationTone = "insight" | "action" | "report" | "system";

export interface WorkspaceNotification {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: NotificationTone;
  read: boolean;
  href?: string | null;
}

type NotificationRow = { id: string; title: string; body: string; type: NotificationTone; read_at: string | null; created_at: string; href?: string | null };

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return { url, key };
}

function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function fetchNotifications(session: AuthSession) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("Notification storage is not configured.");
  const response = await fetch(`${url}/rest/v1/notifications?user_id=eq.${encodeURIComponent(session.user.id)}&select=id,title,body,type,read_at,created_at,href&order=created_at.desc&limit=20`, {
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Notifications could not be loaded.");
  const rows = await response.json() as NotificationRow[];
  return rows.map((row) => ({ id: row.id, title: row.title, detail: row.body, time: relativeTime(row.created_at), tone: row.type, read: Boolean(row.read_at), href: row.href }));
}

export async function markNotificationsRead(session: AuthSession, ids: string[]) {
  if (!ids.length) return true;
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error("Notification storage is not configured.");
  const response = await fetch(`${url}/rest/v1/notifications?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ read_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("Notifications could not be marked as read.");
  return true;
}
