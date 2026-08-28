# Phase 4 transactional email

The Inbox always saves email as a draft first. It offers **Send email** only when the server has both a valid Resend API key and a verified From address. Customer-portal invitations, team invitations, and estimate approvals use the same provider-backed delivery ledger. A message is never marked sent from a browser click alone: the provider must return a real message ID, and signed webhooks advance it to delivered or failed.

Every outbound email automatically includes the agency signature **Team at Torres & Co. Technology LLC** and a confidentiality notice for unintended recipients. The footer is added server-side and is idempotent, so retries cannot duplicate it.

## Secure attachments

- Staff can attach PDF, JPG, PNG, WebP, TXT, CSV, DOCX, and XLSX files to an unsent email draft.
- Each file is limited to 10 MB, with no more than 5 files or 20 MB of raw attachments per email. This stays below Resend's encoded message limit.
- Files are stored in the private `communication-attachments` Supabase Storage bucket. The browser never receives a service-role key or a public object URL.
- Upload, removal, and download requests pass through authenticated, tenant-scoped Cloudflare Functions.
- Attachments are downloaded from private storage and encoded by the server only when Resend accepts the outbound message.
- Sent attachments remain available to authorized staff from the Inbox record; editable draft files can be removed before sending.

## Estimate approval workflow

- **Send estimate** resolves the active client portal member first, then the active customer account, client email, or first client contact as a controlled fallback.
- The client receives a branded `estimate_review` email with a secure sign-in link scoped to the correct client and service job.
- A draft becomes client-visible and sent only when a real recipient and Resend configuration exist. If every provider delivery fails, the estimate is returned to draft and remains private.
- Estimate state and `email_deliveries.idempotency_key` prevent duplicate sends during retries or repeated clicks.
- When an authorized client accepts or rejects the estimate, the response is saved atomically. The assigned or creating staff member then receives an `estimate_decision` email, with owner/admin fallback.
- A notification failure never reverses a valid client decision; the UI reports that the response saved and whether the team email was delivered.

## One-time production setup

1. Apply [`supabase/transactional_email.sql`](../supabase/transactional_email.sql) after `communications.sql`, then apply [`supabase/communication_attachments.sql`](../supabase/communication_attachments.sql).
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
3. Attach a small controlled PDF, confirm it appears in the draft, remove and re-add it once, then click **Send email**. Confirm the state changes from Draft to Sent only after provider acceptance.
4. Wait for the signed webhook and confirm the state changes to Delivered, or shows a readable failure reason.
5. Confirm the client portal does not expose staff-only email drafts.
6. From Clients, prepare a customer activation and confirm the UI says **email accepted** only after Resend returns a provider message ID.
7. From Settings, invite a team member and confirm the same tracked-email behavior and fallback link.
8. From Operations, send a real draft estimate and confirm it stays draft when no client email exists, changes to Sent only after provider acceptance, and opens the correct estimate after sign-in.
9. Accept or reject the estimate as the client and confirm the decision persists and the responsible staff mailbox receives the decision email.
10. Confirm the recipient receives the attached PDF plus one signature and confidentiality notice, and confirm authorized staff can download the retained private attachment from the sent Inbox message.

Resend webhook delivery is at least once. `email_delivery_events.provider_event_id` deduplicates retries, and `email_deliveries.idempotency_key` prevents duplicate sends during request retries.
