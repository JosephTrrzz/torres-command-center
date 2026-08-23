interface Env {
  GOOGLE_CLIENT_ID?: string;
  PUBLIC_APP_URL?: string;
}

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPkcePair() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64url(verifierBytes.buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

function redirect(url: string) {
  return Response.redirect(url, 302);
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const requestUrl = new URL(request.url);
  const clientId = requestUrl.searchParams.get("client");
  const appUrl = env.PUBLIC_APP_URL || "https://torres-command-center-app.pages.dev";
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return redirect(`${appUrl}/integrations/?error=Choose%20a%20client%20before%20connecting%20Google`);
  if (!env.GOOGLE_CLIENT_ID) return redirect(`${appUrl}/integrations/?error=Google%20OAuth%20is%20not%20configured`);

  const state = crypto.randomUUID();
  const pkce = await createPkcePair();
  const callback = `${new URL(request.url).origin}/api/google/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  auth.searchParams.set("redirect_uri", callback);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", pkce.challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("scope", ["openid", "email", "profile", "https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/business.manage"].join(" "));

  const headers = new Headers({ Location: auth.toString() });
  headers.append("Set-Cookie", `cc_google_state=${state}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  headers.append("Set-Cookie", `cc_google_client=${clientId}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  headers.append("Set-Cookie", `cc_google_verifier=${pkce.verifier}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 302, headers });
};
