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

## Integration framework

Each provider implements a common adapter lifecycle: authorize, verify, discover resources, save mapping, sync, normalize, report freshness, refresh credentials, and disconnect. Raw provider responses are retained only when required and are never used directly by UI components. Normalized data includes source, tenant, external identifier, observed time, synced time, and freshness status.

## Background work

Durable work is represented in an event outbox before execution. Workers claim pending events, record attempts, apply bounded retries, and move exhausted work to a dead-letter state. User-facing state distinguishes queued, running, delayed, failed, and complete.

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
