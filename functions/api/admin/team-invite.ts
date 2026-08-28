import { authJson, getSupabaseUrl, requireAuth, type FunctionEnv, type OrganizationRole } from "../../_shared/auth";
import { createNotification } from "../../_shared/notifications";
import { buildTransactionalEmailHtml, type EmailEnv } from "../../_shared/email";
import { activationEmailKey, sendTrackedEmail } from "../../_shared/tracked-email";

interface Env extends FunctionEnv, EmailEnv {
  PUBLIC_APP_URL?: string;
}

const INVITABLE_ROLES = ["admin", "operator", "member", "viewer"] as const;
type InvitableRole = typeof INVITABLE_ROLES[number];

const serviceHeaders = (serviceKey: string) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
});

function isInvitableRole(value: unknown): value is InvitableRole {
  return INVITABLE_ROLES.includes(value as InvitableRole);
}

function productionAppUrl(request: Request, configuredUrl?: string) {
  const requestOrigin = new URL(request.url).origin;
  const candidate = (configuredUrl || "").trim().replace(/\/$/, "");
  try {
    const hostname = new URL(candidate).hostname;
    return candidate && !["localhost", "127.0.0.1", "::1"].includes(hostname) ? candidate : requestOrigin;
  } catch {
    return requestOrigin;
  }
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const auth = await requireAuth(request, env, { staffOnly: true, permission: "organization.manage" });
  if ("response" in auth) return auth.response;

  const input = await request.json().catch(() => null) as { email?: string; fullName?: string; role?: OrganizationRole } | null;
  const email = input?.email?.trim().toLowerCase() || "";
  const fullName = input?.fullName?.trim() || "";
  const role = input?.role;
  if (!email || !email.includes("@") || !fullName || !isInvitableRole(role)) return authJson({ error: "Add a valid name, email, and team role." }, 400);

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return authJson({ error: "Team invitations are not configured." }, 500);
  const headers = serviceHeaders(serviceKey);
  const agencyMembership = auth.context.memberships.find((membership) => membership.kind === "agency" && ["owner", "admin"].includes(membership.role));
  const organizationId = agencyMembership?.organizationId || auth.context.organizationId;
  if (!organizationId) return authJson({ error: "Your agency organization could not be resolved." }, 403);

  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&kind=eq.agency&status=eq.active&select=id,name&limit=1`, { headers });
  const organizations = await organizationResponse.json().catch(() => []) as Array<{ id?: string; name?: string }>;
  const organization = organizations[0];
  if (!organizationResponse.ok || !organization?.id) return authJson({ error: "Only an active agency organization can invite team members." }, 403);

  const profileResponse = await fetch(`${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,role,active&limit=1`, { headers });
  const profiles = await profileResponse.json().catch(() => []) as Array<{ id?: string; role?: string; active?: boolean }>;
  const existingProfile = profiles[0];
  const redirectTo = `${productionAppUrl(request, env.PUBLIC_APP_URL)}/login/?returnTo=/`;
  const linkType = existingProfile?.id ? "magiclink" : "invite";
  const linkResponse = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: linkType,
      email,
      redirect_to: redirectTo,
      data: { full_name: fullName, role: "employee", organization_id: organization.id, organization_role: role },
    }),
  });
  const linkBody = await linkResponse.json().catch(() => ({})) as { action_link?: string; user?: { id?: string }; msg?: string; message?: string };
  if (!linkResponse.ok || !linkBody.action_link) return authJson({ error: linkBody.msg || linkBody.message || "Supabase could not prepare the team invitation." }, 502);
  const invitedUserId = linkBody.user?.id || existingProfile?.id;
  if (!invitedUserId) return authJson({ error: "Supabase did not return the invited account." }, 502);

  const existingMembershipResponse = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(organization.id)}&user_id=eq.${encodeURIComponent(invitedUserId)}&select=status,joined_at&limit=1`, { headers });
  const existingMemberships = await existingMembershipResponse.json().catch(() => []) as Array<{ status?: string; joined_at?: string | null }>;
  const membershipStatus = existingMemberships[0]?.status === "active" ? "active" : "invited";
  const now = new Date().toISOString();
  const membershipResponse = await fetch(`${url}/rest/v1/organization_memberships?on_conflict=organization_id,user_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ organization_id: organization.id, user_id: invitedUserId, role, status: membershipStatus, invited_by: auth.context.userId, joined_at: membershipStatus === "active" ? existingMemberships[0]?.joined_at || now : null, updated_at: now }),
  });
  if (!membershipResponse.ok) return authJson({ error: "The account was created, but its organization membership could not be saved." }, 502);

  const keepOwnerRole = existingProfile?.role === "owner";
  const profileUpdateResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(invitedUserId)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ email, full_name: fullName, role: keepOwnerRole ? "owner" : "employee", active: existingProfile?.active === true || membershipStatus === "active", default_organization_id: organization.id, updated_at: now }),
  });
  if (!profileUpdateResponse.ok) return authJson({ error: "The organization membership was saved, but the account profile could not be prepared." }, 502);

  const pendingResponse = await fetch(`${url}/rest/v1/organization_invitations?organization_id=eq.${encodeURIComponent(organization.id)}&email=eq.${encodeURIComponent(email)}&status=eq.pending&select=id&limit=1`, { headers });
  const pendingRows = await pendingResponse.json().catch(() => []) as Array<{ id?: string }>;
  let invitationId = pendingRows[0]?.id;
  if (invitationId) {
    const invitationUpdateResponse = await fetch(`${url}/rest/v1/organization_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ role, invited_by: auth.context.userId, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), updated_at: now }),
    });
    if (!invitationUpdateResponse.ok) return authJson({ error: "The secure link was created, but its invitation record could not be refreshed." }, 502);
  } else {
    const invitationResponse = await fetch(`${url}/rest/v1/organization_invitations`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ organization_id: organization.id, email, role, status: "pending", invited_by: auth.context.userId }),
    });
    const invitationRows = await invitationResponse.json().catch(() => []) as Array<{ id?: string }>;
    invitationId = invitationRows[0]?.id;
    if (!invitationResponse.ok) return authJson({ error: "The secure link was created, but its invitation record could not be saved." }, 502);
  }

  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ organization_id: organization.id, actor_user_id: auth.context.userId, action: "organization.invitation.created", entity_type: "organization_invitation", entity_id: invitationId || null, metadata: { email, role, invited_user_id: invitedUserId } }),
    }),
    createNotification(env, {
      userId: auth.context.userId,
      type: "action",
      title: "Team invitation ready",
      body: `${fullName} was invited to ${organization.name || "your agency workspace"} as ${role}.`,
      href: "/settings/#admin-console",
    }),
  ]);

  const organizationName = organization.name || "Torres & Co.";
  const subject = `Join ${organizationName} in Torres OS`;
  const text = `Hello ${fullName},\n\nYou have been invited to join ${organizationName} as ${role}. Use the private activation link below to sign in and open your assigned workspace.\n\nActivate workspace access: ${linkBody.action_link}\n\nThis link is private and expires. If you did not expect this invitation, you can ignore this email.`;
  const delivery = await sendTrackedEmail(env, {
    supabaseUrl: url,
    serviceKey,
    organizationId: organization.id,
    recipient: email,
    subject,
    text,
    html: buildTransactionalEmailHtml({
      heading: `Join ${organizationName}`,
      preheader: `Activate your ${role} workspace access.`,
      body: `Hello ${fullName},\n\nYou have been invited to join ${organizationName} as ${role}. Activate your account to open the workspace and tools assigned to you.\n\nThis private link expires. If you did not expect this invitation, you can ignore this email.`,
      action: { label: "Activate workspace access", url: linkBody.action_link },
    }),
    templateKey: "team_workspace_activation",
    idempotencyKey: await activationEmailKey(`team-activation:${organization.id}:${email}`, linkBody.action_link),
  });

  return authJson({
    invited: true,
    email,
    role,
    activationLink: linkBody.action_link,
    emailSent: delivery.sent,
    deliveryStatus: delivery.status,
    ...(delivery.error ? { emailError: delivery.error } : {}),
    message: delivery.sent
      ? `Invitation email accepted for delivery to ${email}. The secure link is also available as a fallback.`
      : `The secure activation link is ready, but email was not sent${delivery.error ? `: ${delivery.error}` : "."} Copy and share the link privately.`,
  });
};
