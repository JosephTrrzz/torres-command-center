# Torres OS product specification

Updated 2026-08-25.

## Product vision

Torres OS is an intelligence and operations layer for local businesses. It gives Torres & Co. an agency workspace for onboarding and managing clients, while each client receives a private workspace for daily operations, reporting, communications, and guided growth. Contractors are the first specialized vertical; a generic local-business mode remains available.

## Primary users

- Agency owner: configures the platform, manages clients, integrations, billing, security, and portfolio reporting.
- Agency operator: performs assigned onboarding, client success, reporting, and implementation work.
- Client owner: manages the business, goals, staff access, leads, jobs, finances, marketing, and reports.
- Client staff: works only in explicitly assigned areas and records.
- Viewer: read-only access to selected workspace information.

## Product modes

- Agency mode: portfolio overview, clients, onboarding, projects, tasks, integrations, reports, billing, support, and platform administration.
- Client mode: Today, customers and CRM, jobs, calendar, estimates, finance, marketing, communications, documents, analytics, AI, and automations.
- Preview mode: an authorized agency user can inspect the exact client experience without changing tenant identity or weakening RLS.

## First complete vertical slice

The first end-to-end slice is:

1. An agency admin creates a client.
2. The client receives and accepts an invitation.
3. The client completes a resumable profile, goals, and data-source setup.
4. A website lead enters the client workspace and is assigned.
5. An appointment appears on the calendar and creates an actionable task.
6. The Today view summarizes priorities and verified signals.
7. The user can ask Torres AI a scoped question with cited workspace evidence.
8. Project progress and a weekly report are visible to authorized users.
9. Important actions appear in an immutable audit history.

## Core capabilities

- Tenant and membership management with role-based permissions.
- Guided, resumable client onboarding and activation links.
- Customer 360, lead pipeline, jobs, tasks, appointments, estimates, and documents.
- Connected communications, marketing, review, website, payment, and analytics providers.
- Provider-normalized metrics with freshness and provenance.
- Transparent reports that can be previewed before print or export.
- Torres AI with tenant-scoped retrieval, citations, approval gates, and audit logs.
- Opportunity scoring, recommended actions, and reversible automations.
- Billing, support, import/export, observability, and platform administration.

## Product principles

- Real state over decorative state.
- One obvious next action per screen.
- Explain why a metric, recommendation, or error exists.
- Keep admin controls separate from client-facing language and workflows.
- Mobile layouts must remain task-complete, not merely responsive.
- English and Spanish content must share stable message keys and avoid embedding business logic in translated copy.

## Definition of done

A capability is complete only when its UI, mobile behavior, server contract, validation, authentication, authorization, RLS, loading/empty/error states, audit or event behavior, automated tests, build verification, documentation, and manual end-to-end check are complete. Setup cards and unverified provider credentials are not considered a completed integration.
