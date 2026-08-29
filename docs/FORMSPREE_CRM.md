# Website and Formspree CRM intake

The Torres & Co. website consultation form creates a real `Website / New` lead in the existing Command Center CRM through a first-party, server-to-server Cloudflare Function. Formspree remains the email-notification copy. The CRM intake secret never reaches the browser, the honeypot is ignored, submission retries are deduplicated, and CRM activity, audit, outbox, and owner-notification history are recorded.

This first-party route is the production path because Formspree outbound webhooks require a paid plan. The signed Formspree webhook remains available as an optional provider path if the account is upgraded later.

## One-time setup

1. Apply [`supabase/formspree_crm.sql`](../supabase/formspree_crm.sql) after [`supabase/crm.sql`](../supabase/crm.sql).
2. In **Cloudflare → Workers & Pages → torres-command-center-app → Settings → Variables and secrets**, add these Production values:
   - Secret `WEBSITE_INTAKE_SECRET`: a strong random value shared only with the public website Function.
   - Secret `WEBSITE_LEADS_CLIENT_ID`: the Command Center client UUID that owns website leads.
3. In **Cloudflare → Workers & Pages → torres-co-technology → Settings → Variables and secrets**, add:
   - Secret `COMMAND_CENTER_INTAKE_SECRET`: the same random value.
   - Secret `COMMAND_CENTER_INTAKE_URL`: `https://admin.torrescotechnology.com/api/leads/website`.
   - Secret `FORMSPREE_FORM_ID`: `mrennqzo`.
4. Redeploy both Pages projects.

Optional paid Formspree webhook setup:

1. In **torres-command-center-app**, add:
   - Secret `FORMSPREE_WEBHOOK_SECRET`: the signing secret shown by Formspree after the webhook is created.
   - Text `FORMSPREE_CLIENT_ID`: the Command Center client UUID that should own these website leads.
   - Text `FORMSPREE_FORM_ID`: the Formspree form ID, not the full endpoint URL.
2. In **Formspree → Forms → the website consultation form → Settings → Plugins → Webhooks**, add:

   `https://admin.torrescotechnology.com/api/webhooks/formspree`

3. Copy the webhook signing secret into Cloudflare, save it, and redeploy Production.

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

Email labels are matched case-insensitively and tolerate common form-builder names such as `Email Address`, `emailAddress`, `contactEmail`, and `_replyto`. When Formspree retries an existing submission, the webhook backfills contact fields that were previously empty without replacing CRM edits that already contain a value.

## Verification

Submit the live website form once with a real test address. In the Command Center, open the organization-wide **CRM** and confirm the lead appears as `Website / New`. The owner notification bell should also show **New website lead**.

Formspree Simple Webhooks are a paid-plan feature. Do not expose either signing secret in browser JavaScript; both production secrets belong only in Cloudflare Pages Functions.
