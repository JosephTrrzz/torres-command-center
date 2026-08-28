import {
  authJson,
  getSupabaseUrl,
  hasOrganizationPermission,
  requireAuth,
  type AuthContext,
  type FunctionEnv,
} from "../../_shared/auth";
import {
  buildTransactionalEmailHtml,
  emailConfigured,
  escapeEmailHtml,
  type EmailEnv,
} from "../../_shared/email";
import { sendTrackedEmail } from "../../_shared/tracked-email";

interface Env extends FunctionEnv, EmailEnv {
  PUBLIC_APP_URL?: string;
}

type ClientRow = { id: string; organization_id: string | null; name: string; industry: string; location: string };
type ContactRow = { id: string; name: string; role: string; email: string };
type SuppressionRow = { email: string; reason: string };
type JobRow = { id: string; job_number: string; title: string; completed_at: string | null };
type CampaignRow = {
  id: string;
  campaign_type: "announcement" | "newsletter" | "review_request";
  name: string;
  subject: string;
  preview_text: string;
  body: string;
  review_url: string | null;
  service_job_id: string | null;
  status: "draft" | "sending" | "sent" | "partial" | "canceled";
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};
type RecipientRow = {
  id: string;
  campaign_id: string;
  email: string;
  display_name: string;
  consent_basis: "business_relationship" | "explicit_opt_in";
  status: "pending" | "sending" | "sent" | "delivered" | "delivery_delayed" | "failed" | "bounced" | "complained" | "suppressed";
  unsubscribe_token: string;
  error_detail: string;
  sent_at: string | null;
  delivered_at: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const campaignTypes = new Set(["announcement", "newsletter", "review_request"]);
const consentBases = new Set(["business_relationship", "explicit_opt_in"]);

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validHttpUrl(value: string) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function normalizedEmail(value: unknown) {
  const email = clean(value, 320).toLowerCase();
  return emailPattern.test(email) ? email : "";
}

async function resolveClient(url: string, serviceKey: string, requestedClientId: string) {
  if (!uuidPattern.test(requestedClientId)) return null;
  const response = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(requestedClientId)}&select=id,organization_id,name,industry,location&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = response.ok ? await response.json().catch(() => []) as ClientRow[] : [];
  return rows[0] || null;
}

async function writeLifecycle(url: string, serviceKey: string, input: {
  organizationId: string;
  userId: string;
  action: string;
  entityId: string;
  clientId: string;
  metadata?: Record<string, unknown>;
}) {
  const metadata = { client_id: input.clientId, ...(input.metadata || {}) };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: input.organizationId, actor_user_id: input.userId, action: input.action, entity_type: "marketing_campaign", entity_id: input.entityId, metadata }),
    }),
    fetch(`${url}/rest/v1/event_outbox`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: input.organizationId, event_type: input.action, aggregate_type: "marketing_campaign", aggregate_id: input.entityId, payload: metadata }),
    }),
  ]);
}

function summary(
  campaigns: Array<CampaignRow & { recipients: Array<Pick<RecipientRow, "status">> }>,
  contacts: Array<ContactRow & { suppressed: boolean }>,
) {
  const recipients = campaigns.flatMap((campaign) => campaign.recipients);
  return {
    drafts: campaigns.filter((campaign) => campaign.status === "draft").length,
    sentCampaigns: campaigns.filter((campaign) => ["sent", "partial"].includes(campaign.status)).length,
    eligibleContacts: contacts.filter((contact) => Boolean(contact.email) && !contact.suppressed).length,
    deliveredRecipients: recipients.filter((recipient) => recipient.status === "delivered").length,
    suppressedContacts: contacts.filter((contact) => contact.suppressed).length,
  };
}

async function readSnapshot(url: string, serviceKey: string, context: AuthContext, client: ClientRow, env: Env) {
  const [contactsResponse, suppressionsResponse, jobsResponse, campaignsResponse] = await Promise.all([
    fetch(`${url}/rest/v1/client_people?client_id=eq.${encodeURIComponent(client.id)}&select=id,name,role,email&order=created_at.asc`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/marketing_suppressions?organization_id=eq.${encodeURIComponent(client.organization_id || "")}&select=email,reason`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/service_jobs?client_id=eq.${encodeURIComponent(client.id)}&status=eq.completed&select=id,job_number,title,completed_at&order=completed_at.desc.nullslast&limit=50`, { headers: serviceHeaders(serviceKey) }),
    fetch(`${url}/rest/v1/marketing_campaigns?client_id=eq.${encodeURIComponent(client.id)}&select=id,campaign_type,name,subject,preview_text,body,review_url,service_job_id,status,sent_at,created_at,updated_at&order=updated_at.desc&limit=100`, { headers: serviceHeaders(serviceKey) }),
  ]);
  if (campaignsResponse.status === 404 || suppressionsResponse.status === 404) return null;
  if (![contactsResponse, suppressionsResponse, jobsResponse, campaignsResponse].every((response) => response.ok)) throw new Error("The campaign workspace could not be loaded.");
  const contactRows = await contactsResponse.json().catch(() => []) as ContactRow[];
  const suppressionRows = await suppressionsResponse.json().catch(() => []) as SuppressionRow[];
  const jobs = await jobsResponse.json().catch(() => []) as JobRow[];
  const campaignRows = await campaignsResponse.json().catch(() => []) as CampaignRow[];
  let recipients: RecipientRow[] = [];
  if (campaignRows.length) {
    const response = await fetch(`${url}/rest/v1/marketing_campaign_recipients?campaign_id=in.(${campaignRows.map((campaign) => campaign.id).join(",")})&select=id,campaign_id,email,display_name,consent_basis,status,unsubscribe_token,error_detail,sent_at,delivered_at&order=created_at.asc`, { headers: serviceHeaders(serviceKey) });
    if (!response.ok) throw new Error("Campaign recipients could not be loaded.");
    recipients = await response.json().catch(() => []) as RecipientRow[];
  }
  const suppressionMap = new Map(suppressionRows.map((row) => [row.email.toLowerCase(), row.reason]));
  const contacts = contactRows.map((contact) => {
    const email = normalizedEmail(contact.email);
    return {
      ...contact,
      email,
      suppressed: Boolean(email && suppressionMap.has(email)),
      suppression_reason: email ? suppressionMap.get(email) || "" : "",
    };
  });
  const campaigns = campaignRows.map((campaign) => ({
    ...campaign,
    recipients: recipients.filter((recipient) => recipient.campaign_id === campaign.id).map(({ campaign_id: _campaignId, unsubscribe_token: _unsubscribeToken, ...recipient }) => recipient),
  }));
  return {
    client: { id: client.id, name: client.name, industry: client.industry || "", location: client.location || "" },
    canManage: hasOrganizationPermission(context, "marketing.manage"),
    delivery: emailConfigured(env) ? "ready" : "not_configured",
    contacts,
    completedJobs: jobs,
    campaigns,
    summary: summary(campaigns, contacts),
  };
}

async function authenticatedClient(request: Request, env: Env, requestedClientId: string, permission: "marketing.read" | "marketing.manage") {
  const auth = await requireAuth(request, env, { staffOnly: true, permission });
  if ("response" in auth) return auth;
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return { response: authJson({ error: "Campaign storage is not configured." }, 500) };
  const client = await resolveClient(url, serviceKey, requestedClientId);
  if (!client?.organization_id) return { response: authJson({ error: "Choose a client before managing campaigns." }, 404) };
  const scoped = await requireAuth(request, env, { staffOnly: true, clientId: client.id, permission });
  if ("response" in scoped) return scoped;
  return { context: scoped.context, client, url, serviceKey };
}

async function campaignById(url: string, serviceKey: string, clientId: string, campaignId: string) {
  const response = await fetch(`${url}/rest/v1/marketing_campaigns?id=eq.${encodeURIComponent(campaignId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,campaign_type,name,subject,preview_text,body,review_url,service_job_id,status,sent_at,created_at,updated_at&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = response.ok ? await response.json().catch(() => []) as CampaignRow[] : [];
  return rows[0] || null;
}

function publicAppUrl(env: Env, request: Request) {
  const configured = clean(env.PUBLIC_APP_URL, 500).replace(/\/$/, "");
  if (configured && validHttpUrl(configured)) return configured;
  return new URL(request.url).origin;
}

function emailContent(campaign: CampaignRow, recipient: RecipientRow, unsubscribeUrl: string) {
  const greeting = recipient.display_name ? `Hi ${recipient.display_name},\n\n` : "";
  const body = `${greeting}${campaign.body}\n\nEmail preferences: ${unsubscribeUrl}`;
  const baseHtml = buildTransactionalEmailHtml({
    heading: campaign.subject,
    preheader: campaign.preview_text || campaign.subject,
    body: `${greeting}${campaign.body}`,
    ...(campaign.campaign_type === "review_request" && campaign.review_url
      ? { action: { label: "Leave a review", url: campaign.review_url } }
      : {}),
  });
  const preference = `<p style="margin:22px 0 0;color:#777;font-size:11px;line-height:1.5">You can <a href="${escapeEmailHtml(unsubscribeUrl)}" style="color:#8f6d35">unsubscribe from future campaign emails</a> at any time.</p>`;
  const bodyClose = baseHtml.toLowerCase().lastIndexOf("</body>");
  const html = bodyClose >= 0 ? `${baseHtml.slice(0, bodyClose)}${preference}${baseHtml.slice(bodyClose)}` : `${baseHtml}${preference}`;
  return { text: body, html };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const clientId = new URL(request.url).searchParams.get("client") || "";
  if (!uuidPattern.test(clientId)) return authJson({ error: "Choose a valid client." }, 400);
  const resolved = await authenticatedClient(request, env, clientId, "marketing.read");
  if ("response" in resolved) return resolved.response;
  try {
    const snapshot = await readSnapshot(resolved.url, resolved.serviceKey, resolved.context, resolved.client, env);
    if (!snapshot) return authJson({ error: "Campaign storage is not ready. Apply supabase/marketing.sql first." }, 503);
    return authJson({ snapshot });
  } catch (error) {
    return authJson({ error: error instanceof Error ? error.message : "The campaign workspace could not be loaded." }, 500);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = clean(input?.action, 60);
  const clientId = clean(input?.clientId, 36);
  if (!action || !uuidPattern.test(clientId)) return authJson({ error: "A valid campaign action and client are required." }, 400);
  const resolved = await authenticatedClient(request, env, clientId, "marketing.manage");
  if ("response" in resolved) return resolved.response;
  const { client, context, url, serviceKey } = resolved;
  const organizationId = client.organization_id;
  if (!organizationId) return authJson({ error: "The selected client is not attached to an organization." }, 409);

  if (action === "create_campaign") {
    const campaignType = clean(input?.campaignType, 30);
    const name = clean(input?.name, 140);
    const subject = clean(input?.subject, 998);
    const previewText = clean(input?.previewText, 240);
    const body = clean(input?.body, 12000);
    const reviewUrl = clean(input?.reviewUrl, 1000);
    const serviceJobId = clean(input?.serviceJobId, 36);
    const consentBasis = clean(input?.consentBasis, 40);
    const contactIds = Array.isArray(input?.contactIds)
      ? Array.from(new Set(input.contactIds.filter((value): value is string => typeof value === "string" && uuidPattern.test(value)))).slice(0, 25)
      : [];
    if (!campaignTypes.has(campaignType) || !name || !subject || !body || !consentBases.has(consentBasis) || !contactIds.length) {
      return authJson({ error: "Complete the campaign details, consent basis, and at least one recipient." }, 400);
    }
    if (campaignType === "review_request" && !validHttpUrl(reviewUrl)) return authJson({ error: "Review requests require a valid HTTPS review link." }, 400);
    if (serviceJobId) {
      const jobResponse = await fetch(`${url}/rest/v1/service_jobs?id=eq.${encodeURIComponent(serviceJobId)}&client_id=eq.${encodeURIComponent(client.id)}&status=eq.completed&select=id&limit=1`, { headers: serviceHeaders(serviceKey) });
      const jobs = jobResponse.ok ? await jobResponse.json().catch(() => []) as Array<{ id?: string }> : [];
      if (!jobs[0]?.id) return authJson({ error: "Choose a completed service job belonging to this client." }, 400);
    }
    const contactsResponse = await fetch(`${url}/rest/v1/client_people?client_id=eq.${encodeURIComponent(client.id)}&id=in.(${contactIds.join(",")})&select=id,name,email`, { headers: serviceHeaders(serviceKey) });
    if (!contactsResponse.ok) return authJson({ error: "Campaign recipients could not be verified." }, 500);
    const contacts = (await contactsResponse.json().catch(() => []) as Array<{ id: string; name: string; email: string }>)
      .map((contact) => ({ ...contact, email: normalizedEmail(contact.email) }))
      .filter((contact) => Boolean(contact.email));
    if (!contacts.length) return authJson({ error: "The selected contacts do not have valid email addresses." }, 400);
    const suppressionResponse = await fetch(`${url}/rest/v1/marketing_suppressions?organization_id=eq.${encodeURIComponent(organizationId)}&select=email`, { headers: serviceHeaders(serviceKey) });
    const suppressed = new Set((suppressionResponse.ok ? await suppressionResponse.json().catch(() => []) as Array<{ email: string }> : []).map((row) => row.email.toLowerCase()));
    const eligible = contacts.filter((contact) => !suppressed.has(contact.email));
    if (!eligible.length) return authJson({ error: "All selected recipients are suppressed from campaign email." }, 400);
    const campaignResponse = await fetch(`${url}/rest/v1/marketing_campaigns`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({
        organization_id: organizationId,
        client_id: client.id,
        service_job_id: serviceJobId || null,
        campaign_type: campaignType,
        name,
        subject,
        preview_text: previewText,
        body,
        review_url: campaignType === "review_request" ? reviewUrl : null,
        status: "draft",
        created_by: context.userId,
      }),
    });
    const campaigns = campaignResponse.ok ? await campaignResponse.json().catch(() => []) as CampaignRow[] : [];
    const campaign = campaigns[0];
    if (!campaign) return authJson({ error: "The campaign draft could not be created." }, 500);
    const recipientResponse = await fetch(`${url}/rest/v1/marketing_campaign_recipients`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify(eligible.map((contact) => ({
        organization_id: organizationId,
        client_id: client.id,
        campaign_id: campaign.id,
        client_person_id: contact.id,
        email: contact.email,
        display_name: clean(contact.name, 160),
        consent_basis: consentBasis,
      }))),
    });
    if (!recipientResponse.ok) {
      await fetch(`${url}/rest/v1/marketing_campaigns?id=eq.${encodeURIComponent(campaign.id)}`, { method: "DELETE", headers: serviceHeaders(serviceKey, "return=minimal") });
      return authJson({ error: "Campaign recipients could not be attached to the draft." }, 500);
    }
    await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "marketing.campaign_created", entityId: campaign.id, clientId: client.id, metadata: { campaign_type: campaignType, recipient_count: eligible.length, suppressed_count: contacts.length - eligible.length } });
  } else if (action === "send_test" || action === "send_campaign") {
    const campaignId = clean(input?.campaignId, 36);
    if (!uuidPattern.test(campaignId)) return authJson({ error: "Choose a valid campaign." }, 400);
    if (!emailConfigured(env)) return authJson({ error: "Transactional email is not configured in Cloudflare." }, 503);
    const campaign = await campaignById(url, serviceKey, client.id, campaignId);
    if (!campaign) return authJson({ error: "This campaign does not belong to the selected client." }, 404);
    if (action === "send_test") {
      const recipientEmail = normalizedEmail(context.email);
      if (!recipientEmail) return authJson({ error: "Your staff profile needs a valid email before sending a test." }, 400);
      const testRecipient: RecipientRow = { id: crypto.randomUUID(), campaign_id: campaign.id, email: recipientEmail, display_name: "", consent_basis: "business_relationship", status: "pending", unsubscribe_token: crypto.randomUUID(), error_detail: "", sent_at: null, delivered_at: null };
      const content = emailContent(campaign, testRecipient, `${publicAppUrl(env, request)}/campaigns/`);
      const result = await sendTrackedEmail(env, {
        supabaseUrl: url,
        serviceKey,
        organizationId,
        clientId: client.id,
        recipient: recipientEmail,
        subject: `[TEST] ${campaign.subject}`,
        text: content.text,
        html: content.html,
        templateKey: "marketing_test",
        idempotencyKey: `campaign-test:${campaign.id}:${crypto.randomUUID()}`,
      });
      if (!result.sent) return authJson({ error: result.error || "The test email could not be sent." }, 502);
    } else {
      if (clean(input?.confirmation, 20) !== "SEND") return authJson({ error: "Type SEND to confirm this campaign delivery." }, 400);
      if (campaign.status !== "draft") return authJson({ error: "Only a draft campaign can be sent." }, 409);
      const recipientResponse = await fetch(`${url}/rest/v1/marketing_campaign_recipients?campaign_id=eq.${encodeURIComponent(campaign.id)}&status=eq.pending&select=id,campaign_id,email,display_name,consent_basis,status,unsubscribe_token,error_detail,sent_at,delivered_at&order=created_at.asc&limit=25`, { headers: serviceHeaders(serviceKey) });
      const recipients = recipientResponse.ok ? await recipientResponse.json().catch(() => []) as RecipientRow[] : [];
      if (!recipients.length) return authJson({ error: "This draft has no pending recipients." }, 409);
      const suppressionsResponse = await fetch(`${url}/rest/v1/marketing_suppressions?organization_id=eq.${encodeURIComponent(organizationId)}&select=email`, { headers: serviceHeaders(serviceKey) });
      const suppressions = new Set((suppressionsResponse.ok ? await suppressionsResponse.json().catch(() => []) as Array<{ email: string }> : []).map((row) => row.email.toLowerCase()));
      await fetch(`${url}/rest/v1/marketing_campaigns?id=eq.${encodeURIComponent(campaign.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "sending", updated_at: new Date().toISOString() }) });
      let sent = 0;
      let failed = 0;
      let suppressedCount = 0;
      for (const recipient of recipients) {
        const now = new Date().toISOString();
        if (suppressions.has(recipient.email.toLowerCase())) {
          suppressedCount += 1;
          await fetch(`${url}/rest/v1/marketing_campaign_recipients?id=eq.${encodeURIComponent(recipient.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "suppressed", error_detail: "Recipient is on the organization suppression list.", updated_at: now }) });
          continue;
        }
        await fetch(`${url}/rest/v1/marketing_campaign_recipients?id=eq.${encodeURIComponent(recipient.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "sending", updated_at: now }) });
        const unsubscribeUrl = `${publicAppUrl(env, request)}/api/campaigns/unsubscribe?token=${encodeURIComponent(recipient.unsubscribe_token)}`;
        const content = emailContent(campaign, recipient, unsubscribeUrl);
        const result = await sendTrackedEmail(env, {
          supabaseUrl: url,
          serviceKey,
          organizationId,
          clientId: client.id,
          recipient: recipient.email,
          subject: campaign.subject,
          text: content.text,
          html: content.html,
          templateKey: `marketing_${campaign.campaign_type}`,
          idempotencyKey: `campaign:${campaign.id}:recipient:${recipient.id}`,
        });
        const patch = result.sent
          ? { status: "sent", email_delivery_id: result.deliveryId || null, provider_message_id: result.providerMessageId || null, error_detail: result.error || "", sent_at: now, updated_at: now }
          : { status: "failed", email_delivery_id: result.deliveryId || null, error_detail: result.error || "Email provider rejected the request.", updated_at: now };
        const update = await fetch(`${url}/rest/v1/marketing_campaign_recipients?id=eq.${encodeURIComponent(recipient.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify(patch) });
        if (result.sent && update.ok) sent += 1;
        else failed += 1;
      }
      const sentAt = new Date().toISOString();
      const status = failed > 0 ? "partial" : "sent";
      await fetch(`${url}/rest/v1/marketing_campaigns?id=eq.${encodeURIComponent(campaign.id)}`, { method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status, sent_at: sentAt, updated_at: sentAt }) });
      await writeLifecycle(url, serviceKey, { organizationId, userId: context.userId, action: "marketing.campaign_sent", entityId: campaign.id, clientId: client.id, metadata: { sent, failed, suppressed: suppressedCount, status } });
      if (!sent && failed) return authJson({ error: "The provider did not accept any campaign email. Review the recipient errors before retrying." }, 502);
    }
  } else {
    return authJson({ error: "This campaign action is not supported." }, 400);
  }

  try {
    const snapshot = await readSnapshot(url, serviceKey, context, client, env);
    if (!snapshot) return authJson({ error: "Campaign storage is not ready. Apply supabase/marketing.sql first." }, 503);
    return authJson({ snapshot, message: action === "create_campaign" ? "Campaign draft created." : action === "send_test" ? "Test email sent to your staff address." : "Campaign delivery completed." });
  } catch {
    return authJson({ message: "The campaign action completed. Refresh the workspace to see its latest state." });
  }
};
