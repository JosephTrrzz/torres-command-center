import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";

type Env = FunctionEnv;

function headers(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

async function hashToken(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function icsText(value: unknown) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function calendarResponse(events: Array<{ uid: string; title: string; description?: string; startsAt: string; endsAt?: string | null; status?: string }>) {
  const generated = icsDate(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Torres & Co. Technology//Torres OS Operations//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Torres OS Operations", "X-WR-CALDESC:Live Operations schedule from Torres OS"];
  for (const event of events) {
    const end = event.endsAt || new Date(new Date(event.startsAt).getTime() + 30 * 60_000).toISOString();
    lines.push("BEGIN:VEVENT", `UID:${icsText(event.uid)}@torrescotechnology.com`, `DTSTAMP:${generated}`, `DTSTART:${icsDate(event.startsAt)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsText(event.title)}`, `DESCRIPTION:${icsText(event.description)}`, `STATUS:${event.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(`${lines.join("\r\n")}\r\n`, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "inline; filename=torres-operations.ics", "Cache-Control": "private, no-store" } });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return new Response("Calendar subscription not found.", { status: 404 });
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return new Response("Calendar service unavailable.", { status: 503 });
  const tokenHash = await hashToken(token);
  const subscriptionResponse = await fetch(`${url}/rest/v1/calendar_subscriptions?token_hash=eq.${tokenHash}&active=eq.true&select=id,client_id,include_private&limit=1`, { headers: headers(serviceKey) });
  const subscriptions = subscriptionResponse.ok ? await subscriptionResponse.json().catch(() => []) as Array<{ id: string; client_id: string; include_private: boolean }> : [];
  const subscription = subscriptions[0];
  if (!subscription) return new Response("Calendar subscription not found.", { status: 404 });
  const visibility = subscription.include_private ? "" : "&client_visible=eq.true";
  const [jobsResponse, appointmentsResponse, tasksResponse] = await Promise.all([
    fetch(`${url}/rest/v1/service_jobs?client_id=eq.${subscription.client_id}&scheduled_start=not.is.null${visibility}&select=id,title,description,status,scheduled_start,scheduled_end`, { headers: headers(serviceKey) }),
    subscription.include_private ? fetch(`${url}/rest/v1/crm_appointments?client_id=eq.${subscription.client_id}&select=id,title,status,starts_at,ends_at`, { headers: headers(serviceKey) }) : Promise.resolve(new Response("[]", { status: 200 })),
    subscription.include_private ? fetch(`${url}/rest/v1/crm_tasks?client_id=eq.${subscription.client_id}&due_at=not.is.null&select=id,title,description,status,due_at`, { headers: headers(serviceKey) }) : Promise.resolve(new Response("[]", { status: 200 })),
  ]);
  if (!jobsResponse.ok || !appointmentsResponse.ok || !tasksResponse.ok) return new Response("Calendar schedule unavailable.", { status: 502 });
  const jobs = await jobsResponse.json() as Array<{ id: string; title: string; description?: string; status?: string; scheduled_start: string; scheduled_end?: string | null }>;
  const appointments = await appointmentsResponse.json() as Array<{ id: string; title: string; status?: string; starts_at: string; ends_at?: string | null }>;
  const tasks = await tasksResponse.json() as Array<{ id: string; title: string; description?: string; status?: string; due_at: string }>;
  const events = [
    ...jobs.map((item) => ({ uid: `job-${item.id}`, title: item.title, description: item.description, status: item.status, startsAt: item.scheduled_start, endsAt: item.scheduled_end })),
    ...appointments.map((item) => ({ uid: `appointment-${item.id}`, title: item.title, status: item.status, startsAt: item.starts_at, endsAt: item.ends_at })),
    ...tasks.map((item) => ({ uid: `task-${item.id}`, title: item.title, description: item.description, status: item.status, startsAt: item.due_at })),
  ];
  await fetch(`${url}/rest/v1/calendar_subscriptions?id=eq.${subscription.id}`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ last_accessed_at: new Date().toISOString() }) }).catch(() => null);
  return calendarResponse(events);
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body = await request.json().catch(() => null) as { clientId?: unknown; action?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || (body?.action !== "create" && body?.action !== "revoke")) return authJson({ error: "Choose a valid calendar action." }, 400);
  const auth = await requireAuth(request, env, { clientId, permission: "operations.read", staffOnly: true });
  if ("response" in auth) return auth.response;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const clientResponse = await fetch(`${url}/rest/v1/clients?id=eq.${clientId}&select=organization_id&limit=1`, { headers: headers(serviceKey) });
  const clients = clientResponse.ok ? await clientResponse.json().catch(() => []) as Array<{ organization_id?: string }> : [];
  if (!clients[0]?.organization_id) return authJson({ error: "Client organization not found." }, 404);
  if (body.action === "revoke") {
    const revokeResponse = await fetch(`${url}/rest/v1/calendar_subscriptions?user_id=eq.${auth.context.userId}&client_id=eq.${clientId}&provider=eq.apple`, { method: "PATCH", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }) });
    if (!revokeResponse.ok) return authJson({ error: "Apple Calendar access could not be revoked." }, 502);
    await fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: clients[0].organization_id, actor_user_id: auth.context.userId, action: "calendar.subscription_revoked", entity_type: "client", entity_id: clientId, metadata: { provider: "apple" } }) }).catch(() => null);
    return authJson({ message: "Apple Calendar access was revoked." });
  }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(36));
  const token = btoa(String.fromCharCode(...Array.from(tokenBytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenHash = await hashToken(token);
  const includePrivate = auth.context.organizationRole !== "client" && auth.context.role !== "customer";
  const saveResponse = await fetch(`${url}/rest/v1/calendar_subscriptions?on_conflict=user_id,client_id,provider`, { method: "POST", headers: headers(serviceKey, "resolution=merge-duplicates,return=minimal"), body: JSON.stringify({ organization_id: clients[0].organization_id, client_id: clientId, user_id: auth.context.userId, provider: "apple", token_hash: tokenHash, include_private: includePrivate, active: true, updated_at: new Date().toISOString() }) });
  if (!saveResponse.ok) return authJson({ error: "Apply supabase/apple_calendar.sql before connecting Apple Calendar." }, 503);
  await fetch(`${url}/rest/v1/audit_events`, { method: "POST", headers: headers(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: clients[0].organization_id, actor_user_id: auth.context.userId, action: "calendar.subscription_created", entity_type: "client", entity_id: clientId, metadata: { provider: "apple", include_private: includePrivate } }) }).catch(() => null);
  const origin = new URL(request.url).origin;
  const httpsUrl = `${origin}/api/calendar/apple?token=${encodeURIComponent(token)}`;
  return authJson({ message: "Private Apple Calendar subscription ready.", subscriptionUrl: httpsUrl.replace(/^https:/, "webcal:"), httpsUrl });
};
