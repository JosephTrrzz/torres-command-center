# Implementation status

Updated 2026-08-25.

## Phase 1 — foundation

| Area | Status | Notes |
| --- | --- | --- |
| Role route model | In place | Owner, employee, and customer landing/access rules exist. |
| Client isolation | Hardened in this pass | Reports and Google Functions now validate bearer auth; customer report scope is checked server-side. |
| Supabase RLS | In place | Existing policies cover core client/account tables; review migrations before production changes. |
| Google OAuth | In place, gated | Staff-only start/status/property access; provider approval can still block Business Profile discovery. |
| Reports | In place | Connected/disconnected states and live provider metrics are supported where mappings exist. |
| Notifications | Live foundation complete | Popover reads persisted, user-scoped rows, supports retry/mark-read, and client invitation/activation workflows create real events. Additional workflow producers belong in later phases. |
| Docs/env baseline | In place | See the files in this directory and `.env.example`. |
| Release verification | Passed locally | Tests, application and Function type checks, whitespace validation, and the production build passed before deployment. |

## Phase 2 — onboarding vertical slice

| Area | Status | Notes |
| --- | --- | --- |
| Protected client creation | Live | Creates the client, active organization, profile, primary location, onboarding state, audit event, and outbox event. |
| Resumable onboarding | Live | Five-step business, location, service, goal, and review flow for clients and authorized agency staff. |
| Agency visibility | Live | Client list/detail surfaces onboarding progress and opens the same scoped workflow without impersonation. |
| Client portal continuity | Live | Incomplete clients receive a continue-onboarding prompt and customer navigation includes Onboarding. |
| Verification | Passed | 21 tests, application and Function type checks, whitespace validation, production build, migration execution, route checks, and unauthenticated API-boundary checks pass. |

## Phase 2 — project delivery vertical slice

| Area | Status | Notes |
| --- | --- | --- |
| Project workspace | Live | Role-aware agency and client workspace for real projects, milestones, deliverables, and requests. |
| Transparent progress | Live | Progress is derived from persisted milestone completion and cannot be directly edited. |
| Protected mutations | Live | `/api/projects` enforces tenant scope and permissions, recalculates progress, and writes audit/outbox events. |
| Client visibility | Live | Clients can view delivery state and submit scoped requests without receiving agency management controls. |
| Production migration | Applied | `supabase/client_projects.sql` was applied successfully on 2026-08-25 without seeded demo records. |
| Verification | Passed | 24 tests, application and Function type checks, whitespace validation, production build, migration execution, route checks, and unauthenticated API-boundary checks pass. |

## Later phases

Client 360 enhancements, collaboration, calendar/newsletters/AI, billing, and additional integrations remain planned or setup-only. They must not be described as production-complete until their backend contracts, permissions, empty/error states, and tests exist.

## Manual gates

Google Business Profile provider approval/quota remains an external gate. The notifications, client onboarding, and project delivery migrations were applied and verified on 2026-08-25; production deployments and secrets remain auditable operator actions.
