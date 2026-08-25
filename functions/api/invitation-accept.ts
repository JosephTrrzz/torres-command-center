import { authJson, getSupabaseUrl, type FunctionEnv, type OrganizationRole } from "../_shared/auth";

interface Env extends FunctionEnv {}

type PendingInvitation = {
  id: string;
  organization_id: string;
  role: OrganizationRole;
  invited_by: string | null;
};

const serviceHeaders = (serviceKey: string) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
});

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const url = getSupabaseUrl(env);
  const anonKey = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const authorization = request.headers.get("Authorization") || "";
  if (!url || !anonKey || !serviceKey) return authJson({ error: "Invitation activation is not configured." }, 500);
  if (!authorization.startsWith("Bearer ")) return authJson({ error: "Open the invitation link before activating your account." }, 401);

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!userResponse.ok) return authJson({ error: "This invitation session has expired." }, 401);
  const user = await userResponse.json() as { id?: string; email?: string };
  const email = user.email?.trim().toLowerCase() || "";
  if (!user.id || !email) return authJson({ error: "This invitation is missing an account identity." }, 400);

  const headers = serviceHeaders(serviceKey);
  const invitationsResponse = await fetch(
    `${url}/rest/v1/organization_invitations?email=eq.${encodeURIComponent(email)}&status=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,organization_id,role,invited_by`,
    { headers },
  );
  const invitations = invitationsResponse.ok
    ? await invitationsResponse.json().catch(() => []) as PendingInvitation[]
    : [];
  if (!invitationsResponse.ok) return authJson({ error: "The invitation record could not be verified." }, 502);

  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,default_organization_id&limit=1`, { headers });
  const profileRows = await profileResponse.json().catch(() => []) as Array<{ role?: string; default_organization_id?: string | null }>;
  const profile = profileRows[0];
  const now = new Date().toISOString();

  for (const invitation of invitations) {
    const existingMembershipResponse = await fetch(
      `${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(invitation.organization_id)}&user_id=eq.${encodeURIComponent(user.id)}&select=joined_at&limit=1`,
      { headers },
    );
    const existingMembershipRows = await existingMembershipResponse.json().catch(() => []) as Array<{ joined_at?: string | null }>;
    const membershipResponse = await fetch(`${url}/rest/v1/organization_memberships?on_conflict=organization_id,user_id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
        status: "active",
        invited_by: invitation.invited_by,
        joined_at: existingMembershipRows[0]?.joined_at || now,
        updated_at: now,
      }),
    });
    if (!membershipResponse.ok) return authJson({ error: "Your organization membership could not be activated." }, 502);

    const invitationResponse = await fetch(`${url}/rest/v1/organization_invitations?id=eq.${encodeURIComponent(invitation.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "accepted", accepted_by: user.id, accepted_at: now, updated_at: now }),
    });
    if (!invitationResponse.ok) return authJson({ error: "Your access was activated, but the invitation could not be finalized." }, 502);
    await fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        organization_id: invitation.organization_id,
        actor_user_id: user.id,
        action: "organization.invitation.accepted",
        entity_type: "organization_invitation",
        entity_id: invitation.id,
        metadata: { email, role: invitation.role },
      }),
    });
  }

  if (invitations.length && profileResponse.ok) {
    const legacyRole = invitations.some((invitation) => invitation.role === "client") ? "customer" : "employee";
    const keepPrivilegedRole = profile?.role === "owner" || profile?.role === "employee";
    const profileUpdateResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        active: true,
        role: keepPrivilegedRole ? profile?.role : legacyRole,
        default_organization_id: profile?.default_organization_id || invitations[0].organization_id,
        updated_at: now,
      }),
    });
    if (!profileUpdateResponse.ok) return authJson({ error: "Your organization access was activated, but your account profile could not be finalized." }, 502);
  }

  return authJson({ accepted: invitations.length, message: invitations.length ? "Organization access activated." : "No pending organization invitation was required." });
};
