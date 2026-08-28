import { getSupabaseUrl, type FunctionEnv } from "../../_shared/auth";

type RecipientRow = { id: string; organization_id: string; campaign_id: string; email: string; status: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceHeaders(serviceKey: string, prefer?: string) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) };
}

function page(title: string, detail: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f7f4ee;color:#12233d;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100% - 40px));background:#fff;border:1px solid #dfd7ca;border-radius:24px;padding:48px;box-sizing:border-box}.eyebrow{color:#9a7338;font:700 12px monospace;letter-spacing:.14em;text-transform:uppercase}h1{font-size:34px;margin:16px 0 12px}p{color:#6d6a64;line-height:1.65;margin:0}.brand{margin-top:36px;font-weight:700}</style></head><body><main class="card"><div class="eyebrow">Email preferences</div><h1>${title}</h1><p>${detail}</p><div class="brand">Torres &amp; Co. Technology LLC</div></main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: FunctionEnv }) => {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!uuidPattern.test(token)) return page("Invalid preference link", "This unsubscribe link is incomplete or no longer valid.", 400);
  const url = getSupabaseUrl(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return page("Preferences unavailable", "Please try again later or contact the Torres & Co. team.", 503);
  const lookup = await fetch(`${url}/rest/v1/marketing_campaign_recipients?unsubscribe_token=eq.${encodeURIComponent(token)}&select=id,organization_id,campaign_id,email,status&limit=1`, { headers: serviceHeaders(serviceKey) });
  const rows = lookup.ok ? await lookup.json().catch(() => []) as RecipientRow[] : [];
  const recipient = rows[0];
  if (!recipient) return page("Preference link not found", "This link has expired or has already been replaced.", 404);
  const now = new Date().toISOString();
  const suppression = await fetch(`${url}/rest/v1/marketing_suppressions?on_conflict=organization_id,email`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({ organization_id: recipient.organization_id, email: recipient.email.toLowerCase(), reason: "unsubscribed", source: "recipient_link", detail: "Recipient used the campaign email preference link.", updated_at: now }),
  });
  if (!suppression.ok) return page("Preferences unavailable", "Your request could not be saved. Please contact the Torres & Co. team.", 503);
  await Promise.allSettled([
    fetch(`${url}/rest/v1/marketing_campaign_recipients?organization_id=eq.${encodeURIComponent(recipient.organization_id)}&email=eq.${encodeURIComponent(recipient.email)}&status=in.(pending,sending,failed)`, {
      method: "PATCH", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ status: "suppressed", error_detail: "Recipient unsubscribed.", updated_at: now }),
    }),
    fetch(`${url}/rest/v1/event_outbox`, {
      method: "POST", headers: serviceHeaders(serviceKey, "return=minimal"), body: JSON.stringify({ organization_id: recipient.organization_id, event_type: "marketing.recipient_unsubscribed", aggregate_type: "marketing_campaign", aggregate_id: recipient.campaign_id, payload: { recipient_id: recipient.id } }),
    }),
  ]);
  return page("You’re unsubscribed", "You will no longer receive campaign or review-request emails from this workspace. Essential service messages may still be sent when required to deliver work you requested.");
};
