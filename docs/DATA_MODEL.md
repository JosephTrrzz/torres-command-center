# Torres OS data model

Updated 2026-08-25.

## Existing production entities

- `profiles`: application identity, legacy role, and legacy client assignment.
- `clients`: business master record and current health summary.
- `client_people`: contacts attached to a client.
- `customer_accounts`: portal activation and billing connection status.
- `google_connections`: OAuth credentials and mapped Google resources.
- `notifications`: persisted user-scoped activity.

## Phase 1 organization foundation

- `organizations`: agency and client tenant boundaries.
- `organization_memberships`: user-to-organization assignment and role.
- `permissions`: stable permission catalog.
- `role_permissions`: default permission matrix.
- `organization_invitations`: invitation lifecycle without storing plaintext activation tokens.
- `user_preferences`: tenant-scoped user settings.
- `audit_events`: immutable security and business history.
- `event_outbox`: durable background-work handoff.

Existing clients receive a linked client organization through `clients.organization_id`. Existing staff are backfilled into the agency organization; customers are backfilled into their linked client organization. This migration is additive and does not remove `profiles.role` or `profiles.client_id`.

## Planned domain groups

### CRM and operations

`contacts`, `leads`, `lead_assignments`, `pipelines`, `pipeline_stages`, `jobs`, `job_status_history`, `appointments`, `tasks`, `task_assignments`, `estimates`, `estimate_items`, `invoices`, `payments`, `files`, and `document_links`.

### Strategy and intelligence

`goals`, `goal_progress`, `opportunities`, `opportunity_evidence`, `recommendations`, `daily_briefings`, `weekly_reports`, `ai_threads`, `ai_messages`, `ai_citations`, and `ai_approvals`.

### Communications and marketing

`conversations`, `messages`, `message_participants`, `campaigns`, `campaign_deliveries`, `newsletter_issues`, `review_requests`, `call_records`, and `receptionist_actions`.

### Integrations and analytics

`integration_connections`, `integration_resources`, `sync_runs`, `sync_errors`, `metric_definitions`, `metric_observations`, and `report_snapshots`.

### Automation and platform

`automation_rules`, `automation_runs`, `automation_steps`, `subscriptions`, `billing_events`, `support_cases`, `imports`, `exports`, and `feature_flags`.

## Modeling conventions

- Tenant-owned tables include `organization_id`; client-specific records may also include `client_id` during transition.
- External resources include provider, external ID, and connection ID.
- Metrics include period start/end, observed time, synchronized time, source, and raw/normalized values.
- Mutable records include `created_at`, `updated_at`, and where useful `created_by`/`updated_by`.
- Deletion defaults to archival for business records. Credential and privacy deletion follows explicit retention rules.
- Money uses integer minor units plus ISO currency; timestamps use `timestamptz`.

## Migration discipline

Migrations are ordered, additive, idempotent where practical, and tested against existing rows. Backfills must be deterministic. RLS is enabled in the same migration that introduces tenant-owned tables, before browser access is granted.
