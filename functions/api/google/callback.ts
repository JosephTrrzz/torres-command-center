interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PUBLIC_APP_URL?: string;
}

function redirect(url: string) { return Response.redirect(url, 302); }
function cookieValue(request: Request, name: string) {
  return request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const appUrl = env.PUBLIC_APP_URL || "https://torres-command-center-app.pages.dev";
  const current = new URL(request.url);
  const error = current.searchParams.get("error");
  if (error) return redirect(`${appUrl}/integrations/?error=${encodeURIComponent(error)}`);
  const code = current.searchParams.get("code");
  const state = current.searchParams.get("state");
  if (!code || !state || state !== cookieValue(request, "cc_google_state")) return redirect(`${appUrl}/integrations/?error=Google%20authorization%20expired%20or%20invalid`);

  const clientId = cookieValue(request, "cc_google_client");
  const callback = `${current.origin}/api/google/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID || "", client_secret: env.GOOGLE_CLIENT_SECRET || "", redirect_uri: callback, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return redirect(`${appUrl}/integrations/?error=Google%20could%20not%20complete%20authorization`);
  const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!tokens.access_token || !clientId) return redirect(`${appUrl}/integrations/?error=Google%20did%20not%20return%20a%20usable%20connection`);
  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const identity = await identityResponse.json() as { email?: string };
  const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY || !identity.email) return redirect(`${appUrl}/integrations/?error=Google%20connection%20storage%20is%20not%20configured`);
  const saveResponse = await fetch(`${supabaseUrl}/rest/v1/google_connections?on_conflict=client_id`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ client_id: clientId, google_email: identity.email, access_token: tokens.access_token, refresh_token: tokens.refresh_token || null, expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), scopes: (tokens.scope || "").split(" ").filter(Boolean), updated_at: new Date().toISOString() }) });
  if (!saveResponse.ok) return redirect(`${appUrl}/integrations/?error=Google%20connection%20was%20authorized%20but%20could%20not%20be%20saved`);
  return redirect(`${appUrl}/integrations/?client=${encodeURIComponent(clientId)}&connected=google`);
};
