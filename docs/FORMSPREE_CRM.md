# Formspree CRM intake

The Torres & Co. website consultation form can create a real `Website / New` lead in the existing Command Center CRM. The Cloudflare Pages Function verifies the Formspree signature before it writes anything, ignores the website honeypot field, deduplicates provider retries, and records CRM activity, audit, outbox, and owner-notification history.

## One-time setup

1. Apply [`supabase/formspree_crm.sql`](../supabase/formspree_crm.sql) after [`supabase/crm.sql`](../supabase/crm.sql).
2. In **Cloudflare → Workers & Pages → torres-command-center-app → Settings → Variables and secrets**, add these Production values:
   - Secret `FORMSPREE_WEBHOOK_SECRET`: the signing secret shown by Formspree after the webhook is created.
   - Text `FORMSPREE_CLIENT_ID`: the Command Center client UUID that should own these website leads.
   - Text `FORMSPREE_FORM_ID`: the Formspree form ID, not the full endpoint URL.
3. In **Formspree → Forms → the website consultation form → Settings → Plugins → Webhooks**, add:

   `https://admin.torrescotechnology.com/api/webhooks/formspree`

4. Copy the webhook signing secret into Cloudflare, save it, and redeploy Production.

For the current Torres website form, the expected form ID is `mrennqzo`. The current Torres & Co. Technology LLC client UUID is `06edc104-71e0-4359-8cb3-42529d65b5d1`.

## Field mapping

| Website form | CRM lead |
| --- | --- |
| `name` | Full name |
| `businessName` | Company |
| `email` | Email |
| `phone` | Phone |
| `service` | Service interest |
| `description` | Message |
| `contactMethod` | Preferred-contact note and source metadata |

The webhook stores only this whitelisted business information. It never stores the signing secret or the full request in audit events. Formspree retries return success without creating another lead.

## Verification

Submit the live website form once with a real test address. In the Command Center, open **CRM**, choose **Torres & Co. Technology LLC**, and confirm the lead appears as `Website / New`. The owner notification bell should also show **New website lead**.

Formspree Simple Webhooks are a paid-plan feature. If the Webhooks plugin is unavailable, do not expose the signing secret in the website browser; use a server-side website Function as the intake proxy instead.
