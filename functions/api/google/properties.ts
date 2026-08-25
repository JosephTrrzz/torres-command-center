import { requireAuth, getSupabaseUrl } from "../../_shared/auth";

interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function googleGet(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body } as { ok: boolean; status: number; body: any };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client");
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Choose a valid client first." }, 400);
  const auth = await requireAuth(request, env, { staffOnly: true, clientId, permission: "integrations.read" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Google connection storage is not configured." }, 500);

  const connectionResponse = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=access_token,google_email,scopes`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  const connections = await connectionResponse.json() as Array<{ access_token?: string; google_email?: string; scopes?: string[] }>;
  const connection = connections[0];
  if (!connection?.access_token) return json({ error: "Connect Google before choosing properties." }, 409);
  const accessToken = connection.access_token;

  const [searchConsoleResponse, analyticsResponse, accountsResponse] = await Promise.all([
    googleGet("https://www.googleapis.com/webmasters/v3/sites", accessToken),
    googleGet("https://analyticsadmin.googleapis.com/v1alpha/accountSummaries?pageSize=200", accessToken),
    googleGet("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", accessToken),
  ]);

  const businessAccounts = accountsResponse.ok && Array.isArray(accountsResponse.body.accounts) ? accountsResponse.body.accounts : [];
  const locationResponses = await Promise.all(businessAccounts.map((account: { name?: string }) => account.name ? googleGet(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storeCode,websiteUri&pageSize=100`, accessToken) : Promise.resolve({ ok: false, status: 400, body: {} })));
  const locations = locationResponses.flatMap((response) => response.ok && Array.isArray(response.body.locations) ? response.body.locations : []);

  return json({
    googleEmail: connection.google_email || null,
    scopes: connection.scopes || [],
    searchConsole: searchConsoleResponse.ok ? { properties: (searchConsoleResponse.body.siteEntry || []).map((site: any) => ({ siteUrl: site.siteUrl, permissionLevel: site.permissionLevel })) } : { properties: [], error: searchConsoleResponse.body?.error?.message || "Search Console properties could not be loaded." },
    analytics: analyticsResponse.ok ? { properties: (analyticsResponse.body.accountSummaries || []).flatMap((account: any) => (account.propertySummaries || []).map((property: any) => ({ property: property.property, displayName: property.displayName, account: account.displayName }))) } : { properties: [], error: analyticsResponse.body?.error?.message || "Analytics properties could not be loaded." },
    businessProfile: accountsResponse.ok ? { properties: locations.map((location: any) => ({ name: location.name, title: location.title, storeCode: location.storeCode, websiteUri: location.websiteUri })) } : { properties: [], error: accountsResponse.body?.error?.message || "Business Profile locations could not be loaded." },
  });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body = await request.json() as { clientId?: string; businessProfile?: string; searchConsole?: string; analytics?: string };
  if (!body.clientId || !/^[0-9a-f-]{36}$/i.test(body.clientId)) return json({ error: "Choose a valid client first." }, 400);
  const auth = await requireAuth(request, env, { staffOnly: true, clientId: body.clientId, permission: "integrations.manage" });
  if ("response" in auth) return auth.response;
  const supabaseUrl = getSupabaseUrl(env);
  if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Google connection storage is not configured." }, 500);
  const response = await fetch(`${supabaseUrl}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(body.clientId)}`, { method: "PATCH", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ business_profile_location: body.businessProfile || null, search_console_site: body.searchConsole || null, analytics_property: body.analytics || null, updated_at: new Date().toISOString() }) });
  if (!response.ok) return json({ error: "The Google property selections could not be saved." }, 500);
  return json({ saved: true });
};
