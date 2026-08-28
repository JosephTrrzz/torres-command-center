# Phase 4 transactional email

The Inbox always saves email as a draft first. It offers **Send email** only when the server has both a valid Resend API key and a verified From address. A message is never marked sent from a browser click alone: the provider must return a real message ID, and signed webhooks advance it to delivered or failed.

## One-time production setup

1. Apply [`supabase/transactional_email.sql`](../supabase/transactional_email.sql) after `communications.sql`.
2. In Resend, verify `torrescotechnology.com` and create a server API key.
3. In Cloudflare Pages → `torres-command-center-app` → Settings → Variables and Secrets, add these Production values:
   - Secret `RESEND_API_KEY`
   - Text `TRANSACTIONAL_EMAIL_FROM` = `Torres & Co. Technology <notifications@torrescotechnology.com>`
   - Text `TRANSACTIONAL_EMAIL_REPLY_TO` = the monitored support mailbox
   - Secret `RESEND_WEBHOOK_SECRET`
4. In Resend, create a webhook for `https://admin.torrescotechnology.com/api/webhooks/resend` and subscribe to sent, delivered, delivery delayed, failed, bounced, complained, and suppressed email events.
5. Copy that webhook's signing secret into `RESEND_WEBHOOK_SECRET`, then deploy the latest production build.

Do not expose these secrets with a `NEXT_PUBLIC_` prefix. The browser never calls Resend directly.

## Verification

1. Open Inbox as a staff member and select a real client.
2. Create an Email conversation with a mailbox you control.
3. Review the draft, click **Send email**, and confirm the state changes from Draft to Sent only after provider acceptance.
4. Wait for the signed webhook and confirm the state changes to Delivered, or shows a readable failure reason.
5. Confirm the client portal does not expose staff-only email drafts.

Resend webhook delivery is at least once. `email_delivery_events.provider_event_id` deduplicates retries, and `email_deliveries.idempotency_key` prevents duplicate sends during request retries.
