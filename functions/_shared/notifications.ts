import type { FunctionEnv } from "./auth";

export type NotificationType = "insight" | "action" | "report" | "system";

export interface NotificationInput {
  userId: string;
  clientId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
}

export function buildNotificationInsert(input: NotificationInput) {
  return {
    user_id: input.userId,
    client_id: input.clientId || null,
    type: input.type,
    title: input.title.trim(),
    body: input.body.trim(),
    href: input.href || null,
  };
}

export async function createNotification(env: FunctionEnv, input: NotificationInput) {
  const url = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey || !input.userId || !input.title.trim() || !input.body.trim()) return false;

  try {
    const response = await fetch(`${url}/rest/v1/notifications`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(buildNotificationInsert(input)),
    });
    return response.ok;
  } catch {
    return false;
  }
}
