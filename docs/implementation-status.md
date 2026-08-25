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

## Later phases

Client 360 enhancements, collaboration, calendar/newsletters/AI, billing, and additional integrations remain planned or setup-only. They must not be described as production-complete until their backend contracts, permissions, empty/error states, and tests exist.

## Manual gates

Google Business Profile provider approval/quota remains an external gate. The notifications migration was applied and verified on 2026-08-25; production deployments and secrets remain auditable operator actions.
