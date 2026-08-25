# Torres OS architecture decisions

Updated 2026-08-25.

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
