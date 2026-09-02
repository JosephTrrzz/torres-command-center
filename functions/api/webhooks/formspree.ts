import { getSupabaseUrl, type FunctionEnv } from "../../_shared/auth";
import type { EmailEnv } from "../../_shared/email";
import {
  formspreeConfigured,
  formspreeSubmissionFingerprint,
  mapFormspreeLead,
  matchesFormspreeForm,
  missingFormspreeLeadContact,
  verifyFormspreeWebhook,
  type FormspreeEnv,
  type FormspreePayload,
} from "../../_shared/formspree";
import { createNotification } from "../../_shared/notifications";
import { sendLeadAcknowledgment } from "../../_shared/lead-acknowledgment";

interface Env extends FunctionEnv, FormspreeEnv, EmailEnv {}

interface ClientRow { id: string; organization_id: string | null; name: string }
interface ExistingLeadRow { id?: string; email?: string; phone?: string; company?: string; service_interest?: string; message?: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maximumBodyBytes = 128 * 1024;

function serviceHeaders(serviceKey: string, prefer?: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function findNotificationUser(url: string, serviceKey: string, organizationId: string) {
  const organizationResponse = await fetch(`${url}/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}&select=parent_organization_id&limit=1`, { headers: serviceHeaders(serviceKey) });
  const organizations = organizationResponse.ok ? await organizationResponse.json().catch(() => []) as Array<{ parent_organization_id?: string }> : [];
  const agencyId = organizations[0]?.parent_organization_id || organizationId;
  const membershipResponse = await fetch(`${url}/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(agencyId)}&status=eq.active&role=in.(owner,admin)&select=user_id,role&limit=10`, { headers: serviceHeaders(serviceKey) });
  const memberships = membershipResponse.ok ? await membershipResponse.json().catch(() => []) as Array<{ user_id?: string; role?: string }> : [];
  return memberships.find((membership) => membership.role === "owner" && membership.user_id)?.user_id
    || memberships.find((membership) => membership.user_id)?.user_id
    || "";
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!formspreeConfigured(env)) return json({ error: "Form intake is not configured." }, 503);
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) return json({ error: "Payload too large." }, 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maximumBodyBytes) return json({ error: "Payload too large." }, 413);
  if (!await verifyFormspreeWebhook(env, rawBody, request.headers.get("Formspree-Signature"))) return json({ error: "Invalid webhook signature." }, 401);

  let payload: FormspreePayload;
  try {
    payload = JSON.parse(rawBody) as FormspreePayload;
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }
  if (!matchesFormspreeForm(payload.form, env.FORMSPREE_FORM_ID)) return json({ error: "Unexpected form." }, 403);
  const lead = mapFormspreeLead(payload);
  if (lead.isSpam) return json({ accepted: true }, 202);
  if (!lead.fullName || (!lead.email && !lead.phone) || (lead.email && !emailPattern.test(lead.email))) return json({ error: "Submission is missing a valid lead name or contact method." }, 422);

  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const clientId = env.FORMSPREE_CLIENT_ID?.trim() || "";
  if (!url || !serviceKey || !uuidPattern.test(clientId)) return json({ error: "Lead storage is not configured." }, 503);
  const clientResponse = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,organization_id,name&limit=1`, { headers: serviceHeaders(serviceKey) });
  const clients = clientResponse.ok ? await clientResponse.json().catch(() => []) as ClientRow[] : [];
  const client = clients[0];
  if (!client?.organization_id) return json({ error: "Configured client workspace was not found." }, 503);

  const fingerprint = await formspreeSubmissionFingerprint(rawBody);
  const sourceMetadata = {
    provider: "formspree",
    form_id: env.FORMSPREE_FORM_ID?.trim() || "",
    submitted_at: lead.submittedAt,
    contact_method: lead.contactMethod,
    source_url: lead.sourceUrl,
  };
  const insertResponse = await fetch(`${url}/rest/v1/crm_leads?on_conflict=external_provider,external_submission_id`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=ignore-duplicates,return=representation"),
    body: JSON.stringify({
      organization_id: client.organization_id,
      client_id: client.id,
      full_name: lead.fullName,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      service_interest: lead.serviceInterest,
      message: lead.message,
      source: "website",
      status: "new",
      external_provider: "formspree",
      external_submission_id: fingerprint,
      source_metadata: sourceMetadata,
    }),
  });
  if (!insertResponse.ok) return json({ error: "Lead could not be recorded." }, 502);
  const inserted = await insertResponse.json().catch(() => []) as Array<{ id?: string }>;
  let leadId = inserted[0]?.id || "";
  const duplicate = !leadId;
  let repaired = false;
  if (!leadId) {
    const existingResponse = await fetch(`${url}/rest/v1/crm_leads?external_provider=eq.formspree&external_submission_id=eq.${encodeURIComponent(fingerprint)}&select=id,email,phone,company,service_interest,message&limit=1`, { headers: serviceHeaders(serviceKey) });
    const existing = existingResponse.ok ? await existingResponse.json().catch(() => []) as ExistingLeadRow[] : [];
    const existingLead = existing[0];
    leadId = existingLead?.id || "";
    const missingContact = existingLead ? missingFormspreeLeadContact(existingLead, lead) : {};
    if (uuidPattern.test(leadId) && Object.keys(missingContact).length) {
      const repairResponse = await fetch(`${url}/rest/v1/crm_leads?id=eq.${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers: serviceHeaders(serviceKey, "return=minimal"),
        body: JSON.stringify({ ...missingContact, updated_at: new Date().toISOString() }),
      });
      if (!repairResponse.ok) return json({ error: "Lead contact details could not be updated." }, 502);
      repaired = true;
    }
  }
  if (!uuidPattern.test(leadId)) return json({ error: "Lead could not be confirmed." }, 502);
  if (duplicate) return json({ accepted: true, duplicate: true, repaired });

  const eventMetadata = { client_id: client.id, lead_id: leadId, provider: "formspree", form_id: env.FORMSPREE_FORM_ID?.trim() || "" };
  await Promise.allSettled([
    fetch(`${url}/rest/v1/crm_activities`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: client.organization_id, client_id: client.id, lead_id: leadId, activity_type: "lead.created", title: "Website lead captured", detail: `${lead.fullName} submitted the website consultation form.`, metadata: sourceMetadata }),
    }),
    fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: client.organization_id, action: "crm.lead.created", entity_type: "crm_lead", entity_id: leadId, source: "formspree", metadata: eventMetadata }),
    }),
    fetch(`${url}/rest/v1/event_outbox`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ organization_id: client.organization_id, event_type: "crm.lead.created", aggregate_type: "crm_lead", aggregate_id: leadId, payload: eventMetadata }),
    }),
  ]);
  if (lead.email) {
    await sendLeadAcknowledgment(env, {
      supabaseUrl: url,
      serviceKey,
      organizationId: client.organization_id,
      clientId: client.id,
      leadId,
      fullName: lead.fullName,
      email: lead.email,
    }).catch((error) => {
      console.error(JSON.stringify({
        event: "formspree_lead_acknowledgment_failed",
        lead_id: leadId,
        detail: error instanceof Error ? error.message : "Unknown acknowledgment error",
      }));
    });
  }
  const notificationUserId = await findNotificationUser(url, serviceKey, client.organization_id);
  if (notificationUserId) await createNotification(env, {
    userId: notificationUserId,
    clientId: client.id,
    type: "action",
    title: "New website lead",
    body: `${lead.fullName} requested help${lead.serviceInterest ? ` with ${lead.serviceInterest}` : ""}.`,
    href: `/crm/?client=${encodeURIComponent(client.id)}`,
  });
  return json({ accepted: true });
};
