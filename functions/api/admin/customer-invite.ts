import { createNotification } from "../../_shared/notifications";
import { getSupabaseUrl, requireAuth, type FunctionEnv } from "../../_shared/auth";
import { buildTransactionalEmailHtml, type EmailEnv } from "../../_shared/email";
import { activationEmailKey, sendTrackedEmail } from "../../_shared/tracked-email";

interface Env extends FunctionEnv, EmailEnv {
  PUBLIC_APP_URL?: string;
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as { clientId?: string; email?: string; fullName?: string; resend?: boolean } | null;
  const clientId = input?.clientId || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "A valid client is required." }, 400);

  const auth = await requireAuth(request, env, { staffOnly: true, clientId, permission: "clients.manage" });
  if ("response" in auth) return auth.response;

  const supabaseUrl = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "Customer onboarding is not configured." }, 500);

  const clientResponse = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=name,email,organization_id&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const clientRows = await clientResponse.json().catch(() => []) as Array<{ name?: string; email?: string; organization_id?: string | null }>;
  const email = input?.email?.trim().toLowerCase() || clientRows[0]?.email?.trim().toLowerCase() || "";
  const fullName = input?.fullName?.trim() || clientRows[0]?.name?.trim() || "";
  const organizationId = clientRows[0]?.organization_id || null;
  if (!email) return json({ error: "This client needs a contact email before an activation link can be sent." }, 400);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const recordOrganizationInvitation = async (userId?: string) => {
    if (!organizationId) return;
    const now = new Date().toISOString();
    if (userId) {
      const membershipStatusResponse = await fetch(`${supabaseUrl}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(userId)}&select=status,joined_at&limit=1`, { headers: serviceHeaders });
      const membershipStatusRows = await membershipStatusResponse.json().catch(() => []) as Array<{ status?: string; joined_at?: string | null }>;
      const membershipStatus = membershipStatusRows[0]?.status === "active" ? "active" : "invited";
      await fetch(`${supabaseUrl}/rest/v1/organization_memberships?on_conflict=organization_id,user_id`, {
        method: "POST",
        headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ organization_id: organizationId, user_id: userId, role: "client", status: membershipStatus, invited_by: auth.context.userId, joined_at: membershipStatus === "active" ? membershipStatusRows[0]?.joined_at || now : null, updated_at: now }),
      });
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { ...serviceHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ email, full_name: fullName, role: "customer", client_id: clientId, active: Boolean(existingProfileId) || membershipStatus === "active", default_organization_id: organizationId, updated_at: now }),
      });
    }
    const pendingResponse = await fetch(`${supabaseUrl}/rest/v1/organization_invitations?organization_id=eq.${encodeURIComponent(organizationId)}&email=eq.${encodeURIComponent(email)}&status=eq.pending&select=id&limit=1`, { headers: serviceHeaders });
    const pendingRows = await pendingResponse.json().catch(() => []) as Array<{ id?: string }>;
    let invitationId = pendingRows[0]?.id;
    if (invitationId) {
      await fetch(`${supabaseUrl}/rest/v1/organization_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
        method: "PATCH",
        headers: { ...serviceHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ role: "client", invited_by: auth.context.userId, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), updated_at: now }),
      });
    } else {
      const invitationResponse = await fetch(`${supabaseUrl}/rest/v1/organization_invitations`, {
        method: "POST",
        headers: { ...serviceHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ organization_id: organizationId, email, role: "client", status: "pending", invited_by: auth.context.userId }),
      });
      const invitationRows = await invitationResponse.json().catch(() => []) as Array<{ id?: string }>;
      invitationId = invitationRows[0]?.id;
    }
    await fetch(`${supabaseUrl}/rest/v1/audit_events`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ organization_id: organizationId, actor_user_id: auth.context.userId, action: "organization.invitation.created", entity_type: "organization_invitation", entity_id: invitationId || null, metadata: { email, role: "client", client_id: clientId, invited_user_id: userId || null } }),
    });
  };

  // Keep an existing auth profile aligned before generating a resend link. This
  // matters when a client already has a Supabase account but was never assigned
  // to this client record in the Command Center.
  const existingProfile = await fetch(`${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const existingRows = await existingProfile.json().catch(() => []) as Array<{ id?: string }>;
  const existingProfileId = existingRows[0]?.id;
  if (existingProfileId) {
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(existingProfileId)}`, { method: "PATCH", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ email, full_name: fullName, role: "customer", client_id: clientId, active: true, updated_at: new Date().toISOString() }) });
  }

  const requestOrigin = new URL(request.url).origin;
  const configuredAppUrl = (env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
  let appUrl = requestOrigin;
  try {
    const configuredHost = configuredAppUrl ? new URL(configuredAppUrl).hostname : "";
    if (configuredAppUrl && configuredHost && !["localhost", "127.0.0.1", "::1"].includes(configuredHost)) appUrl = configuredAppUrl;
  } catch {
    appUrl = requestOrigin;
  }
  const redirectTo = `${appUrl}/login/?returnTo=/portal/`;
  const notifyStaff = (message: string) => createNotification(env, {
    userId: auth.context.userId,
    clientId,
    type: "action",
    title: "Client activation ready",
    body: message,
    href: `/clients/detail/?id=${encodeURIComponent(clientId)}`,
  });
  const notifyCustomer = (userId: string | undefined) => userId ? createNotification(env, {
    userId,
    clientId,
    type: "action",
    title: "Your Torres & Co. portal is ready",
    body: "Activate your account to review reports and manage your business profile.",
    href: "/portal/",
  }) : Promise.resolve(false);
  const deliverActivationLink = async (actionLink: string) => {
    if (!organizationId) return { sent: false, status: "failed" as const, error: "This client is not assigned to an organization." };
    const subject = `Activate your ${fullName || "client"} portal`;
    const greeting = fullName ? `Hello ${fullName},` : "Hello,";
    const text = `${greeting}\n\nTorres & Co. Technology has prepared your secure client portal. Use the private link below to activate your account and review the workspace assigned to your business.\n\nActivate client portal: ${actionLink}\n\nThis link is private and expires. If you did not expect this invitation, you can ignore this email.`;
    return sendTrackedEmail(env, {
      supabaseUrl,
      serviceKey,
      organizationId,
      clientId,
      recipient: email,
      subject,
      text,
      html: buildTransactionalEmailHtml({
        heading: "Your client portal is ready",
        preheader: "Activate your secure Torres & Co. client portal.",
        body: `${greeting}\n\nTorres & Co. Technology has prepared your secure client portal. Activate your account to review the workspace assigned to your business.\n\nThis private link expires. If you did not expect this invitation, you can ignore this email.`,
        action: { label: "Activate client portal", url: actionLink },
      }),
      templateKey: "customer_portal_activation",
      idempotencyKey: await activationEmailKey(`customer-activation:${clientId}`, actionLink),
    });
  };
  const activationPayload = (delivery: Awaited<ReturnType<typeof deliverActivationLink>>, activationLink: string, invited: boolean) => ({
    invited,
    email,
    activationLink,
    emailSent: delivery.sent,
    deliveryStatus: delivery.status,
    ...(delivery.error ? { emailError: delivery.error } : {}),
    message: delivery.sent
      ? `Activation email accepted for delivery to ${email}. The secure link is also available as a fallback.`
      : `The secure activation link is ready, but email was not sent${delivery.error ? `: ${delivery.error}` : "."} Copy and share the link privately.`,
  });
  if (input?.resend) {
    const linkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", email, redirect_to: redirectTo }) });
    const linkBody = await linkResponse.json().catch(() => ({})) as { action_link?: string; user?: { id?: string }; msg?: string; message?: string };
    if (linkResponse.ok && linkBody.action_link) {
      await recordOrganizationInvitation(linkBody.user?.id || existingProfileId);
      const delivery = await deliverActivationLink(linkBody.action_link);
      await Promise.allSettled([notifyStaff(`${fullName || email} has a fresh portal activation link.`), notifyCustomer(linkBody.user?.id || existingProfileId)]);
      return json(activationPayload(delivery, linkBody.action_link, false));
    }
    const inviteLinkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "invite", email, data: { full_name: fullName, client_id: clientId, role: "customer" }, redirect_to: redirectTo }) });
    const inviteLinkBody = await inviteLinkResponse.json().catch(() => ({})) as { action_link?: string; user?: { id?: string }; msg?: string; message?: string };
    if (inviteLinkResponse.ok && inviteLinkBody.action_link) {
      await recordOrganizationInvitation(inviteLinkBody.user?.id || existingProfileId);
      const delivery = await deliverActivationLink(inviteLinkBody.action_link);
      await Promise.allSettled([notifyStaff(`${fullName || email} has a new portal activation link.`), notifyCustomer(inviteLinkBody.user?.id || existingProfileId)]);
      return json(activationPayload(delivery, inviteLinkBody.action_link, true));
    }
    const inviteAgain = await fetch(`${supabaseUrl}/auth/v1/admin/invite`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, data: { full_name: fullName, client_id: clientId, role: "customer" }, redirect_to: redirectTo }) });
    const inviteAgainBody = await inviteAgain.json().catch(() => ({})) as { user?: { id?: string }; msg?: string; message?: string };
    if (inviteAgain.ok) {
      await recordOrganizationInvitation(inviteAgainBody.user?.id || existingProfileId);
      await Promise.allSettled([notifyStaff(`${fullName || email} was sent a new portal invitation.`), notifyCustomer(inviteAgainBody.user?.id || existingProfileId)]);
      return json({ invited: true, email, message: "A new activation invitation was sent by email." });
    }
    return json({ error: inviteAgainBody.msg || inviteAgainBody.message || inviteLinkBody.msg || inviteLinkBody.message || linkBody.msg || linkBody.message || "Supabase could not prepare an activation link." }, 502);
  }

  const preparedLinkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      type: existingProfileId ? "magiclink" : "invite",
      email,
      data: { full_name: fullName, client_id: clientId, role: "customer" },
      redirect_to: redirectTo,
    }),
  });
  const preparedLinkBody = await preparedLinkResponse.json().catch(() => ({})) as { action_link?: string; user?: { id?: string } };
  if (preparedLinkResponse.ok && preparedLinkBody.action_link) {
    const preparedUserId = preparedLinkBody.user?.id || existingProfileId;
    if (preparedUserId) {
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(preparedUserId)}`, { method: "PATCH", headers: { ...serviceHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ email, full_name: fullName, role: "customer", client_id: clientId, active: Boolean(existingProfileId), updated_at: new Date().toISOString() }) });
    }
    await recordOrganizationInvitation(preparedUserId);
    const accountResponse = await fetch(`${supabaseUrl}/rest/v1/customer_accounts?on_conflict=client_id`, { method: "POST", headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ client_id: clientId, portal_email: email, portal_enabled: true, portal_status: "invited", billing_email: email, billing_status: "not_connected", updated_at: new Date().toISOString() }) });
    if (!accountResponse.ok) return json({ error: "The activation link was prepared, but the customer portal account could not be saved." }, 502);
    const delivery = await deliverActivationLink(preparedLinkBody.action_link);
    await Promise.allSettled([
      notifyStaff(`${fullName || email}'s client portal activation was prepared.`),
      notifyCustomer(preparedUserId),
    ]);
    return json(activationPayload(delivery, preparedLinkBody.action_link, !existingProfileId));
  }

  const inviteResponse = await fetch(`${supabaseUrl}/auth/v1/admin/invite`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, data: { full_name: fullName, client_id: clientId, role: "customer" }, redirect_to: redirectTo }) });
  const inviteBody = await inviteResponse.json().catch(() => ({})) as { user?: { id?: string }; msg?: string; message?: string };
  if (!inviteResponse.ok && inviteResponse.status !== 422) return json({ error: inviteBody.msg || inviteBody.message || "Supabase could not send the customer invitation." }, 502);

  let userId = inviteBody.user?.id;
  if (!userId && inviteResponse.status === 422) {
    userId = existingProfileId;
  }
  if (userId) {
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ email, full_name: fullName, role: "customer", client_id: clientId, active: Boolean(existingProfileId), updated_at: new Date().toISOString() }) });
  }
  await recordOrganizationInvitation(userId);

  const accountResponse = await fetch(`${supabaseUrl}/rest/v1/customer_accounts?on_conflict=client_id`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ client_id: clientId, portal_email: email, portal_enabled: true, portal_status: "invited", billing_email: email, billing_status: "not_connected", updated_at: new Date().toISOString() }) });
  if (!accountResponse.ok) return json({ error: "Invitation sent, but the customer portal account could not be saved." }, 502);
  await Promise.allSettled([
    notifyStaff(inviteResponse.ok ? `${fullName || email} was invited to activate their client portal.` : `${fullName || email}'s client portal is ready for activation.`),
    notifyCustomer(userId),
  ]);
  return json({ invited: inviteResponse.ok, email, message: inviteResponse.ok ? "Customer portal account created and activation email sent." : "Customer portal account is ready. Use Send activation link on this client to generate a fresh link." });
};
