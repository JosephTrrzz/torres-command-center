import { requireAuth, getSupabaseUrl } from "../../_shared/auth";

interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client");
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return json({ connected: false }, 400);

  const auth = await requireAuth(request, env, { staffOnly: true, clientId, permission: "integrations.read" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ connected: false, configured: false }, 200);

  const response = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=google_email,access_token,refresh_token,expires_at,scopes,updated_at`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) return json({ connected: false, configured: false }, 200);
  const rows = await response.json() as Array<{ google_email?: string; access_token?: string; refresh_token?: string | null; expires_at?: string | null; scopes?: string[]; updated_at?: string }>;
  const connection = rows[0];
  if (!connection?.access_token) return json({ connected: false, reason: "Google authorization has not been saved." });

  let accessToken = connection.access_token;
  const expiresSoon = connection.expires_at && new Date(connection.expires_at).getTime() < Date.now() + 60_000;
  if (expiresSoon && connection.refresh_token && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const refreshBody = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    });
    const refreshResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: refreshBody });
    const refreshPayload = await refreshResponse.json() as { access_token?: string; expires_in?: number };
    if (refreshResponse.ok && refreshPayload.access_token) {
      accessToken = refreshPayload.access_token;
      await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ access_token: accessToken, expires_at: new Date(Date.now() + (refreshPayload.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }),
      });
    }
  }

  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!identityResponse.ok) return json({ connected: false, reason: "Google authorization expired. Reconnect Google for this client." });
  return json({ connected: true, googleEmail: connection.google_email || null, scopes: connection.scopes || [], updatedAt: connection.updated_at || null, checkedAt: new Date().toISOString() });
};
