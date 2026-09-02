# Torres OS architecture decisions

Updated 2026-09-01.

## D-001 — evolve the existing product

Decision: Torres OS extends the production Command Center. It is not a clean-room rewrite.

Reason: authentication, client records, portal activation, Google reporting, notifications, reports, custom-domain hosting, and RLS already work. Replacing them would add migration and reliability risk without user value.

## D-002 — modular monolith

Decision: keep one Next.js/Cloudflare deployable application with explicit domain modules.

Reason: current scale does not justify service fragmentation. Domain and adapter boundaries preserve a later extraction path.

## D-003 — additive organization migration

Decision: introduce organizations and memberships beside `profiles.role` and `profiles.client_id`, then migrate routes and Functions incrementally.

Reason: a flag-day authorization rewrite would risk locking out current admins and clients. Compatibility reads remain until tenant tests and production backfills are verified.

## D-004 — server boundary for privileged work

Decision: provider calls, service-role writes, invitation generation, membership changes, exports, AI actions, and background-job control run in Cloudflare Functions.

Reason: browser bundles cannot protect credentials or enforce privileged authorization reliably.

## D-005 — verified state only

Decision: connection, health, metric, and automation states must reflect persisted evidence and provider results.

Reason: setup cards and optimistic labels previously made readiness difficult to judge. Torres OS must distinguish authorization, resource mapping, freshness, and errors.

## D-006 — outbox before distributed infrastructure

Decision: use a Postgres event outbox as the durable contract before selecting additional queue infrastructure.

Reason: it provides transactional handoff, retries, observability, and a future queue migration path while fitting the current stack.

## D-007 — approval-gated AI

Decision: AI may read, summarize, recommend, and draft; consequential external actions require a separate approval record.

Reason: this makes automation useful without obscuring responsibility or creating unsafe side effects.

## D-008 — Cloudflare remains production hosting

Decision: continue Cloudflare Pages and Pages Functions; Vercel is not part of the production path.

Reason: the active projects, domains, environment variables, and automatic GitHub deployments are already configured on Cloudflare.

## D-009 — normalized, resumable onboarding

Decision: store business identity, locations, services, goals, and onboarding progress in organization-scoped tables, with one resumable workflow exposed to both authorized agency staff and the client.

Reason: onboarding must survive interrupted sessions, show the agency exactly what remains, and feed later CRM, reporting, recommendation, and automation domains. A temporary synchronization back to the legacy `clients` record keeps the current product operational while normalized reads are adopted incrementally.

## D-010 — milestone-derived delivery progress

Decision: project progress is calculated from completed milestones and is never entered as an independent percentage.

Reason: milestone-derived progress gives agency staff and clients the same explainable view, prevents optimistic or contradictory status, and provides an auditable foundation for notifications, reports, and automations.

## D-011 — reversible Inbox organization

Decision: Inbox categories use a controlled taxonomy, and archive is a reversible state rather than deletion. Archived conversations remain available to authorized staff but are removed from active workload totals and client portal visibility until restored.

Reason: durable categories make triage consistent across devices, while reversible archiving preserves communication history and prevents an old thread from disappearing permanently or remaining actionable to a client.

## D-012 — CRM owns pre-client communication

Decision: website inquiries and qualified receptionist conversations remain organization-wide CRM leads until they are intentionally linked to a client. Staff can reply through the provider-tracked CRM workflow, pin important leads, and reversibly archive website-chat transcripts. New email leads receive one idempotent acknowledgment when the organization setting is enabled.

Reason: prospects are not clients yet. Keeping acquisition communication in CRM avoids inventing tenant relationships, while the shared delivery ledger, reversible archive state, and configurable acknowledgment preserve operational truth and communication history.
