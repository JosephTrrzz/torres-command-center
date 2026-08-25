# Torres OS execution plan

Updated 2026-08-25.

## Delivery approach

Work proceeds through controlled milestones. Existing production behavior stays available behind compatibility boundaries. A phase is not marked complete merely because its schema or interface exists.

## Phase 0 — repository audit

Status: complete for the 2026-08-25 baseline.

- Inventory routes, Functions, schema, tests, documentation, integrations, and deployment.
- Record passing baseline and known external gates.
- Blend the master Torres OS specification into authoritative repository docs.

## Phase 1 — foundation

Status: complete for the controlled organization cutover.

- Add organizations, memberships, permissions, invitations, preferences, audit events, and event outbox additively.
- Preserve and map the existing profile/client authorization model.
- Add a Today route powered only by real portfolio, report, and notification data.
- Expand cross-tenant and permission tests before switching production reads to organization scope.
- Cut protected Google, reports, and invitation Functions over to organization membership and permission checks with a temporary legacy fallback.
- Replace placeholder team onboarding with server-backed invitations, membership activation, and audit events.

## Phase 2 — agency and client management

Status: in progress.

- Agency/client workspace switcher and authorized preview mode: implemented and deployed. Direct organization switching is membership-bound; agency client previews remain explicitly labeled and do not impersonate or mutate the administrator session.
- Client profile, locations, services, goals, activation handoff, and resumable onboarding: implemented locally as a protected vertical slice; production migration and deployment verification remain.
- Protected client provisioning: implemented locally so future clients receive an organization, business records, and onboarding state instead of bypassing the tenant model.
- Agency project and implementation progress tracking.

## Phase 3 — CRM, customers, tasks, and calendar

- Leads, assignments, pipeline, customer 360, jobs, appointments, tasks, estimates, and documents.
- Complete the vertical slice through website lead → appointment → task.

## Phase 4 — communications and marketing

- Shared inbox, email/SMS/voice adapters, campaigns, newsletters, review requests, and AI receptionist foundations.

## Phase 5 — integrations and normalization

- Common adapter framework, durable sync, normalized data, webhook verification, provider health, and disconnect behavior.

## Phase 6 — analytics and reports

- Metric definitions, snapshots, comparison periods, transparent calculations, client/agency reports, and scheduled delivery.

## Phase 7 — Torres AI

- Tenant-scoped retrieval, cited answers, daily briefing, weekly summary, approvals, audit, and evaluation harness.

## Phase 8 — opportunity engine

- Evidence-backed opportunity detection, scoring, prioritization, status, ownership, and outcome tracking.

## Phase 9 — automations

- Rule builder, event triggers, dry runs, approvals, retries, execution logs, and safe rollback paths.

## Phase 10 — billing, support, and platform administration

- Plans, subscriptions, usage, invoices, support cases, feature flags, imports/exports, and operator tooling.

## Phase 11 — hardening

- Security review, load/performance work, disaster recovery, retention/deletion, accessibility, localization, observability, and complete end-to-end tests.

## Milestone verification

Each milestone runs unit tests, application and Function type checks, production build, migration review, and a targeted browser flow. Deployment occurs only after local verification, and production status is confirmed separately from Git push status.
