interface Env {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PUBLIC_APP_URL?: string;
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
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in as a workspace administrator first." }, 401);

  const caller = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
  if (!caller.ok) return json({ error: "Your admin session has expired. Sign in again." }, 401);
  const callerUser = await caller.json() as { id?: string };
  if (!callerUser.id) return json({ error: "Unable to verify the admin session." }, 401);

  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerUser.id)}&select=role,active&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const callerProfile = (await profileResponse.json() as Array<{ role?: string; active?: boolean }>)[0];
  if (!profileResponse.ok || !callerProfile || !callerProfile.active || !["owner", "employee"].includes(callerProfile.role || "")) return json({ error: "Only workspace staff can invite customers." }, 403);

  const input = await request.json().catch(() => null) as { clientId?: string; email?: string; fullName?: string; resend?: boolean } | null;
  const clientId = input?.clientId || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "A valid client is required." }, 400);

  const clientResponse = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=name,email&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const clientRows = await clientResponse.json().catch(() => []) as Array<{ name?: string; email?: string }>;
  const email = input?.email?.trim().toLowerCase() || clientRows[0]?.email?.trim().toLowerCase() || "";
  const fullName = input?.fullName?.trim() || clientRows[0]?.name?.trim() || "";
  if (!email) return json({ error: "This client needs a contact email before an activation link can be sent." }, 400);

  const redirectTo = `${env.PUBLIC_APP_URL || new URL(request.url).origin}/login/?returnTo=/portal/`;
  if (input?.resend) {
    const linkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", email, redirect_to: redirectTo }) });
    const linkBody = await linkResponse.json().catch(() => ({})) as { action_link?: string; msg?: string; message?: string };
    if (linkResponse.ok && linkBody.action_link) return json({ invited: false, email, activationLink: linkBody.action_link, message: "A fresh activation link is ready. Copy it and send it to the client." });
    const inviteAgain = await fetch(`${supabaseUrl}/auth/v1/admin/invite`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, data: { full_name: fullName, client_id: clientId, role: "customer" }, redirect_to: redirectTo }) });
    const inviteAgainBody = await inviteAgain.json().catch(() => ({})) as { msg?: string; message?: string };
    if (inviteAgain.ok) return json({ invited: true, email, message: "The client does not have an account yet. A new activation invitation has been sent." });
    return json({ error: inviteAgainBody.msg || inviteAgainBody.message || linkBody.msg || linkBody.message || "Supabase could not prepare an activation link." }, 502);
  }

  const inviteResponse = await fetch(`${supabaseUrl}/auth/v1/admin/invite`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, data: { full_name: fullName, client_id: clientId, role: "customer" }, redirect_to: redirectTo }) });
  const inviteBody = await inviteResponse.json().catch(() => ({})) as { user?: { id?: string }; msg?: string; message?: string };
  if (!inviteResponse.ok && inviteResponse.status !== 422) return json({ error: inviteBody.msg || inviteBody.message || "Supabase could not send the customer invitation." }, 502);

  let userId = inviteBody.user?.id;
  if (!userId && inviteResponse.status === 422) {
    const existingProfile = await fetch(`${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    const existingRows = await existingProfile.json().catch(() => []) as Array<{ id?: string }>;
    userId = existingRows[0]?.id;
  }
  if (userId) {
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ email, full_name: fullName, role: "customer", client_id: clientId, active: true, updated_at: new Date().toISOString() }) });
  }

  const accountResponse = await fetch(`${supabaseUrl}/rest/v1/customer_accounts?on_conflict=client_id`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ client_id: clientId, portal_email: email, portal_enabled: true, portal_status: "invited", billing_email: email, billing_status: "not_connected", updated_at: new Date().toISOString() }) });
  if (!accountResponse.ok) return json({ error: "Invitation sent, but the customer portal account could not be saved." }, 502);
  return json({ invited: inviteResponse.ok, email, message: inviteResponse.ok ? "Customer portal account created and activation email sent." : "Customer portal account is ready. Use Send activation link on this client to generate a fresh link." });
};
