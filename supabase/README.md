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

## How the records connect

```text
profiles ── client_id ──> clients <── client_id ── client_people
                              │
                              ├── client_id ── customer_accounts
                              ├── client_id ── google_connections
                              ├── client_id ── notifications <── user_id ── auth.users
                              └── client_id ── service_jobs
                                                   ├── job_activities
                                                   ├── crm_tasks
                                                   ├── job_estimates ── job_estimate_items
                                                   └── job_documents
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

## Important safety rules

- Do not edit or expose `access_token` or `refresh_token` in `google_connections`.
- Do not manually change a customer's `role`, `client_id`, `active`, `portal_enabled`, or `portal_status` unless you are intentionally correcting access and understand the effect.
- Do not delete a `clients` row casually; related contacts, portal settings, and Google mappings reference it.
- Never store passwords, API keys, OAuth secrets, or invitation tokens in contact notes.
- Do not insert shared notifications without a specific `user_id`; every notification belongs to one authenticated user.
- Use the app for normal changes so validation and access controls run consistently.
- Do not insert `audit_events`, `organization_memberships`, `organization_invitations`, or `event_outbox` rows directly from browser code. Those mutations belong behind authenticated server boundaries.
- Do not calculate or overwrite estimate totals directly. The Operations Function validates line items and calculates totals server-side.
- Mark job notes, documents, and estimates client-visible only when they are ready for the customer portal.

## Add descriptions inside Supabase

Run [`schema_descriptions.sql`](./schema_descriptions.sql) in **Supabase → SQL Editor → New query**. It adds table and column comments only; it does not change rows, policies, authentication, or application behavior.
