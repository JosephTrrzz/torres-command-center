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
| Protected client creation | Ready for migration/deploy | Creates the client, active organization, profile, primary location, onboarding state, audit event, and outbox event. |
| Resumable onboarding | Ready for migration/deploy | Five-step business, location, service, goal, and review flow for clients and authorized agency staff. |
| Agency visibility | Ready for migration/deploy | Client list/detail surfaces onboarding progress and opens the same scoped workflow without impersonation. |
| Client portal continuity | Ready for migration/deploy | Incomplete clients receive a continue-onboarding prompt and customer navigation includes Onboarding. |
| Local verification | Passed | 21 tests, application and Function type checks, whitespace validation, and the production build pass. |

## Later phases

Client 360 enhancements, collaboration, calendar/newsletters/AI, billing, and additional integrations remain planned or setup-only. They must not be described as production-complete until their backend contracts, permissions, empty/error states, and tests exist.

## Manual gates

Google Business Profile provider approval/quota remains an external gate. The notifications migration was applied and verified on 2026-08-25. The onboarding migration must be applied before the Phase 2 routes can be used in production; production deployments and secrets remain auditable operator actions.
