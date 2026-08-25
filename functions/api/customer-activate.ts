interface Env {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const authorization = request.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Customer onboarding is not configured." }, 500);
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in to activate your customer portal." }, 401);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!userResponse.ok) return json({ error: "Your sign-in session has expired. Sign in again." }, 401);
  const user = await userResponse.json() as { id?: string };
  if (!user.id) return json({ error: "Unable to verify the customer account." }, 401);

  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,client_id,active&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const profile = (await profileResponse.json().catch(() => [] ) as Array<{ role?: string; client_id?: string | null; active?: boolean }>)[0];
  if (!profileResponse.ok || !profile || profile.role !== "customer" || !profile.client_id || !profile.active) return json({ error: "This account is not assigned to a customer workspace." }, 403);

  const accountResponse = await fetch(`${supabaseUrl}/rest/v1/customer_accounts?client_id=eq.${encodeURIComponent(profile.client_id)}`, { method: "PATCH", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ portal_enabled: true, portal_status: "active", updated_at: new Date().toISOString() }) });
  if (!accountResponse.ok) return json({ error: "Your login worked, but the customer portal account could not be activated." }, 502);
  return json({ active: true, clientId: profile.client_id });
};
