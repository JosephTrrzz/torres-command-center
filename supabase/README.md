# Supabase data guide

Supabase is the Command Center's database, authentication, and protected data layer. The app is the normal place to create clients, invite customers, add contacts, connect Google, and change portal settings. The Supabase Table Editor is mainly for inspection and carefully correcting data.

## What the tables mean

| Table | Plain-language purpose | Normal place to manage it |
| --- | --- | --- |
| `clients` | One row for each business you manage. Contains the business name, industry, address, website, contact details, and health score. | Command Center → Clients |
| `client_people` | Optional people/contacts at a business. These are not login accounts. | Client detail → Contacts |
| `profiles` | Application users and access rules. Connects a Supabase Auth user to an owner, employee, or customer role and, for customers, to a client. | Settings/access and onboarding flow |
| `customer_accounts` | Client portal activation status and billing status. | Client onboarding/settings |
| `google_connections` | Private Google OAuth connection and the selected Business Profile, Search Console, and GA4 resources. | Integrations |
| `notifications` | User-specific workspace activity, such as a client activation link becoming ready. Read state is stored per user. | Notification bell in the app header |
| `organizations` | Agency and client tenant boundaries for Torres OS. Existing clients are linked through `legacy_client_id`. | Torres OS organization settings |
| `organization_memberships` | A user’s role inside a specific agency or client organization. | Team and client access management |
| `permissions` / `role_permissions` | Stable permission catalog and the default role-to-permission matrix. | Platform-managed authorization rules |
| `organization_invitations` | Organization invitation lifecycle metadata. Raw invitation tokens are never stored. | Torres OS onboarding |
| `user_preferences` | User settings synchronized per organization and device. | User settings |
| `audit_events` | Immutable organization-scoped security and business history. | Audit history |
| `event_outbox` | Durable background work for providers, notifications, analytics, AI, and automations. | Server workers only |
| `service_jobs` | The operational record for scheduled or active client work, including status, priority, location, assignment, and client visibility. | Operations |
| `job_activities` | Timeline notes and system events for a service job. | Operations → Job activity |
| `job_estimates` | Estimate lifecycle, totals, approval state, and client-facing message for a job. | Operations → Estimates |
| `job_estimate_items` | Server-validated line items that produce an estimate subtotal, tax, and total. | Operations → Estimate builder |
| `job_documents` | Customer-safe links to proposals, agreements, photos, invoices, and other job records. | Operations → Documents |
| `conversations` | One client-scoped shared Inbox thread with channel, priority, status, and client visibility. | Inbox |
| `message_participants` | Staff, client, external, or system participants associated with an Inbox thread. | Inbox (server-managed) |
| `messages` | Immutable secure messages or unsent email drafts, including real delivery state and client visibility. | Inbox |
| `message_attachments` | Private metadata for files attached to Inbox email drafts. The actual objects remain in a protected Supabase Storage bucket and are served only through authenticated, tenant-scoped Functions. | Inbox |
| `email_deliveries` | Server-owned outbound email attempts. Stores the provider ID, idempotency key, recipient list, and truthful sent/delivered/failed state. | Inbox (server-managed) |
| `email_delivery_events` | Signed, deduplicated provider webhook events for delivery, delay, bounce, complaint, failure, and suppression history. | Inbox (server-managed) |
| `marketing_campaigns` | Client-scoped announcement, newsletter, and review-request drafts with an explicit send lifecycle. | Campaigns |
| `marketing_campaign_recipients` | The reviewed audience and truthful delivery result for each campaign email. Includes consent basis and a private unsubscribe token. | Campaigns (server-managed) |
| `marketing_suppressions` | Organization-wide do-not-send records created by unsubscribes, complaints, bounces, or an administrator. | Campaigns (server-managed) |
| `communication_provider_connections` | Organization-scoped SMS and voice provider readiness. Stores provider references and status, never raw provider secrets. | Inbox → Provider foundation |
| `communication_consents` | A client contact's explicit SMS or voice consent, including purpose, evidence, source, and revocation time. | Inbox → Consent controls |
| `communication_suppressions` | Durable SMS/voice do-not-contact records created by opt-out keywords, provider events, or an administrator. | Inbox (server-managed) |
| `sms_events` | Append-only outbound and inbound SMS lifecycle events, including provider IDs and truthful delivery status. | Inbox (server-managed) |
| `call_records` | Voice call history and provider state. The table is ready before live calling is enabled. | Inbox → Call history |

## How the records connect

```text
profiles ── client_id ──> clients <── client_id ── client_people
                              │
                              ├── client_id ── customer_accounts
                              ├── client_id ── google_connections
                              ├── client_id ── notifications <── user_id ── auth.users
                              ├── client_id ── service_jobs
                                                   ├── job_activities
                                                   ├── crm_tasks
                                                   ├── job_estimates ── job_estimate_items
                                                   └── job_documents
                              └── client_id ── conversations
                                                   ├── message_participants
                                                   └── messages ─┬─ message_attachments
                                                                └─ email_deliveries ── email_delivery_events
                              └── client_id ── marketing_campaigns
                                                   └── marketing_campaign_recipients ── email_deliveries

organizations ── marketing_suppressions (one durable suppression per email address)
              ├── communication_provider_connections
              ├── communication_consents ── client_id ──> clients
              ├── communication_suppressions
              ├── sms_events ── conversation_id ──> conversations
              └── call_records ── conversation_id ──> conversations
```

The `client_id` links are important: they prevent one client's contacts, portal access, or Google properties from being shown for another client.

The additive Torres OS migration in [`torres_os_foundation.sql`](./torres_os_foundation.sql) introduces normalized organizations without removing the current `profiles.role` and `profiles.client_id` access model. Active organization memberships are authoritative in the protected Google, reports, and invitation Functions. Legacy profile fields remain a temporary fallback for accounts that have not been migrated yet.

## What an empty table means

An empty `client_people` table simply means no contacts have been added yet. It does not mean the client record or client portal is broken. Add a contact from the client detail page when you have a real person to record.

## Safe onboarding order

1. Create the business in **Clients**.
2. Add the client's real contacts, if needed.
3. Send the activation link and let the client create their portal access.
4. Confirm the customer's `profiles` row is assigned to the correct `client_id`.
5. Connect Google from **Integrations** and map only that client's resources.
6. Open **Reports** and verify the saved mapping and live metrics.
7. Open **Operations** to create real service jobs, schedule work, prepare estimates, and choose which updates the client may see.
8. Open **Inbox** to start a secure client-visible conversation. Email is saved as a draft first; when the verified provider is configured, staff review and send it from the thread while delivery state updates automatically.
9. Open **Campaigns** to create a client-scoped draft, review eligible contacts, send a staff test, and type `SEND` only when the recipient list and content are ready.
10. Before sending SMS, record the client's real E.164 phone number and explicit consent evidence in **Inbox**. A configured provider, granted consent, and no active suppression are all required.

## Important safety rules

- Do not edit or expose `access_token` or `refresh_token` in `google_connections`.
- Do not manually change a customer's `role`, `client_id`, `active`, `portal_enabled`, or `portal_status` unless you are intentionally correcting access and understand the effect.
- Do not delete a `clients` row casually; related contacts, portal settings, and Google mappings reference it.
- Never store passwords, API keys, OAuth secrets, or invitation tokens in contact notes.
- Do not insert shared notifications without a specific `user_id`; every notification belongs to one authenticated user.
- Use the app for normal changes so validation and access controls run consistently.
- Treat email fields by purpose: `profiles.email` is the Supabase Auth sign-in identity; `clients.email` and `business_profiles.primary_email` are business contact addresses; `customer_accounts` stores portal and billing addresses; `client_people.email` is a contact address. Editing a contact address must not silently change a sign-in identity.
- Do not insert `audit_events`, `organization_memberships`, `organization_invitations`, or `event_outbox` rows directly from browser code. Those mutations belong behind authenticated server boundaries.
- Do not calculate or overwrite estimate totals directly. The Operations Function validates line items and calculates totals server-side.
- Mark job notes, documents, and estimates client-visible only when they are ready for the customer portal.
- Do not mark an email draft as sent manually. Provider delivery state must be written by the protected communications workflow after a real provider response.
- Keep staff-only notes and files out of client-visible conversations and messages.
- Upload email files only through Inbox. The `communication-attachments` bucket is private and must not receive public object policies or public URLs.
- Never bypass `marketing_suppressions` or manually change a campaign recipient to sent. The protected Campaigns Function rechecks suppression immediately before delivery, and provider webhooks own delivery truth.
- Review requests may reference only completed service jobs and require a valid review URL. Campaigns are intentionally limited to 25 recipients while the controlled delivery foundation is being proven.
- Never infer SMS or voice consent from an email address, client relationship, or saved phone number. Consent must be explicit, purpose-specific, and revocable.
- Do not remove SMS/voice suppressions to force a message through. `STOP` and equivalent opt-outs must remain authoritative until the recipient explicitly opts back in.
- Keep Twilio credentials in Cloudflare encrypted secrets. The database stores only provider status and non-secret identifiers.

## Phase migration order

Apply migrations in the documented dependency order. Run [`email_persistence.sql`](./email_persistence.sql) after [`access_control.sql`](./access_control.sql) so confirmed Supabase Auth email changes remain synchronized with `profiles.email`. For Phase 4, run [`communications.sql`](./communications.sql) after the organization/access-control, clients, notifications, CRM, and Operations foundations are present. Then run [`transactional_email.sql`](./transactional_email.sql), [`communication_attachments.sql`](./communication_attachments.sql), [`marketing.sql`](./marketing.sql), and [`sms_voice.sql`](./sms_voice.sql). Provider credentials are configured separately in Cloudflare after the schema is installed. These migrations are additive, create no example business records, and preserve the separate meanings of sign-in, business contact, portal, billing, and person-contact emails.

## Add descriptions inside Supabase

Run [`schema_descriptions.sql`](./schema_descriptions.sql) in **Supabase → SQL Editor → New query**. It adds table and column comments only; it does not change rows, policies, authentication, or application behavior.
