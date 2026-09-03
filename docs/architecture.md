# Torres OS architecture

Updated 2026-08-26.

## Current runtime

- Next.js 14 App Router with React 18 and TypeScript.
- Static application export hosted on Cloudflare Pages.
- Cloudflare Pages Functions under `functions/api` for privileged server work.
- Supabase Auth and Postgres for identity and application data.
- Google OAuth and reporting adapters implemented server-side.

This remains the production architecture. Torres OS will evolve as a modular monolith: cohesive domain modules in one deployable application, with explicit boundaries that can be separated only when scale or isolation requires it.

## Layers

1. Presentation: route components, reusable UI components, form state, and accessible feedback.
2. Application: use cases, permission decisions, orchestration, and provider-independent contracts.
3. Domain: organizations, clients, CRM, jobs, goals, opportunities, reports, automations, and audit semantics.
4. Infrastructure: Supabase repositories, Cloudflare Functions, provider adapters, background jobs, and event outbox.

## Tenant model

An organization is the primary security boundary. Agency organizations can manage child client organizations through explicit memberships and relationships. Existing `clients` rows remain the customer master records and are linked one-to-one to client organizations during migration. The legacy `profiles.client_id` model remains active until all reads and Functions are organization-aware.

An active client member may invite a trusted teammate only into the exact client organization currently selected. The protected server boundary always writes the invited account with the `client` organization role, records the invitation and audit event, and never updates agency membership or the client account's primary billing/contact email. Accepted teammates therefore receive the same permitted Private Office routes and tenant-scoped records, without internal administration access.

## Request flow

Browser requests use the Supabase publishable key plus the signed-in user's access token. Direct reads are constrained by RLS. Privileged writes and third-party calls go through a Cloudflare Function, which validates the token, loads the caller's profile and membership, checks the requested tenant, performs the action with the service role, and writes audit or outbox records.

Personal display-name changes use the protected `/api/profile` self-service boundary. The Function derives the target profile from the verified access token, permits only `full_name`, writes the change to Supabase, and records an audit event. It never accepts a user ID, role, email, organization, or client assignment from the browser. The browser refreshes its cached session only after Supabase confirms the write.

## Integration framework

Each provider implements a common adapter lifecycle: authorize, verify, discover resources, save mapping, sync, normalize, report freshness, refresh credentials, and disconnect. Raw provider responses are retained only when required and are never used directly by UI components. Normalized data includes source, tenant, external identifier, observed time, synced time, and freshness status.

`integration_connections` is the secret-free registry of current provider health, scope, labels, and capabilities. `integration_sync_runs` is its append-only execution ledger. Provider credentials remain in Cloudflare encrypted variables or private provider-specific tables such as `google_connections`; tokens, API keys, and webhook secrets are prohibited from registry metadata.

`provider_metric_observations` is the normalized reporting boundary. GA4 and Search Console adapters upsert daily observations by client, provider, mapped resource, metric, and period. Reports read these stored observations with a truthful `syncedAt` value; they fall back to a live Google request only while the additive Phase 5 table is empty or has not been installed. Rate and rank rollups are weighted by their relevant volume rather than averaged naively. Raw Google responses and credentials are never persisted in this table.

Integration reads and mutations cross an authenticated Cloudflare Function boundary with organization permission and client-access checks. Browser code cannot write health directly. A confirmed Google disconnect attempts provider revocation, removes local authorization and saved mappings, records the resulting disconnected state, and emits an audit event.

Automated provider health is invoked hourly by Supabase `pg_cron` through `pg_net`. The database reads the endpoint and shared credential from Vault and calls a protected Cloudflare Pages Function; the matching credential exists only in Cloudflare's encrypted environment. Each invocation performs at most 25 due checks with bounded provider requests, synchronizes normalized Google observations after a successful Google check, records the trigger and next run, and opens a single administrator notification only after two consecutive failures. Recovery resolves the open alert and emits a recovery notification. The scheduler cannot be invoked by browser credentials and never stores provider secrets in health metadata.

## Background work

Durable work is represented in an event outbox before execution. Workers claim pending events, record attempts, apply bounded retries, and move exhausted work to a dead-letter state. User-facing state distinguishes queued, running, delayed, failed, and complete.

Scheduled integration checks are a bounded exception to the general outbox-consumer flow: the protected scheduler performs the due health request directly and writes every alert transition to both the audit ledger and event outbox. A failed check remains due again at its next interval, while alert delivery is idempotent across an open incident.

## AI boundary

Torres AI receives an explicit organization and user context. Retrieval is tenant-scoped before content reaches a model. Responses identify evidence, freshness, and uncertainty. Any external write, message, publication, financial action, or destructive change requires a separate approval step and an audit record.

## Delivery topology

- Production admin: `https://admin.torrescotechnology.com`
- Static fallback: Cloudflare Pages project domain
- Public company site: separate Cloudflare Pages project
- Database and auth: Supabase project documented in the operator checklist

No browser bundle may contain the Supabase service role, Google client secret, provider access token, or AI provider secret.

## Phase 3 operations domain

The operations workspace extends a won lead or active project into an auditable service workflow:

```text
client + locations + contacts
            │
            └── service job ── activities
                    ├── tasks
                    ├── estimates ── line items
                    ├── documents
                    └── calendar schedule
```

Customer 360 is assembled server-side from the client master record, contacts, locations, CRM history, projects, tasks, and service jobs. All operational writes go through the authenticated `/api/operations` boundary. The Function checks the caller's organization permission and requested client before writing, calculates estimate totals on the server, records activity and audit events, and emits user notifications when an approval or customer-visible update needs attention.

RLS applies both tenant membership and explicit client scope. Customer roles can read only records marked client-visible for their own `current_client_id()` and can respond only to estimates awaiting a decision. Owners and authorized employees manage scheduling, assignments, status, estimates, documents, and tasks. Operational documents are represented as validated HTTPS resources; secrets and provider tokens are never stored as document URLs.

Apple Calendar uses a revocable, read-only iCalendar subscription rather than Apple credentials. The authenticated Operations API creates a high-entropy token, stores only its SHA-256 hash, and returns the private `webcal` URL once. Calendar clients later read the feed through the opaque token. Staff feeds include scheduled jobs, CRM appointments, and task deadlines; customer feeds are restricted to service jobs already marked client-visible. Revocation disables the feed immediately. Two-way CalDAV access is intentionally outside this foundation because it would require separately governed Apple credentials and write-conflict handling.

Client users do not receive a calendar subscription URL. From their tenant-scoped Operations schedule, they may export one client-visible appointment at a time to Google Calendar, Outlook Calendar, or a local RFC 5545-compatible `.ics` file. The browser builds that event from data the user is already authorized to view; no calendar credentials, provider token, or new server-side event store is introduced. Staff subscriptions remain available for internal scheduling continuity.

The staff Schedule route is an aggregate projection, not another calendar domain. Its single authenticated, staff-only Function reads service jobs, CRM appointments, and task deadlines for child client organizations of the active agency and preserves the source client on every event. Mutations stay in the corresponding client Operations workspace. Customer roles do not receive the agency aggregate route and continue to use their tenant-scoped Services calendar.

## Phase 4 communications domain

The shared Inbox is a provider-independent communication boundary:

```text
staff or client browser
        │ signed Supabase session
        ▼
/api/communications
        ├── conversation + immutable message
        ├── audit event + event outbox
        ├── recipient notification
        └── future provider adapter
```

Internal messages are real client-visible records and are available immediately in the customer portal's Inbox. Email is deliberately draft-only until an approved provider is configured; SMS and voice remain visibly unavailable. This prevents the interface from implying that an external message was delivered when no provider accepted it.

The API enforces organization permission and client scope before every read or mutation. Customer users may read and reply only to client-visible conversations for their assigned client. Staff may manage thread priority and status. Direct authenticated table writes are revoked, and RLS repeats the tenant/client visibility boundary as defense in depth.

Campaigns reuse the same tracked-email ledger and signed Resend webhook while keeping audience selection in a separate protected domain:

```text
staff browser → /api/campaigns → draft + reviewed recipients
                                  │
                                  ├── organization suppression check
                                  ├── staff-only test send
                                  └── typed SEND confirmation
                                             │
                                             ▼
                                     email_deliveries + Resend
                                             │ signed webhook
                                             ▼
                                 recipient delivery state + suppression
```

Announcements, newsletters, and review requests belong to one organization and one client. Review requests may reference only a completed service job. Suppressions are organization-wide and are checked during audience creation and immediately before sending. Public unsubscribe links use opaque per-recipient tokens; they never expose tenant identifiers, and they create durable suppression records. Browser writes to campaign, recipient, and suppression tables are revoked.
