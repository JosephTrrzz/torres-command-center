# Torres OS status

Updated 2026-08-25.

## Production foundation

| Area | Status | Evidence |
| --- | --- | --- |
| Custom admin domain | Live | `admin.torrescotechnology.com` serves the Cloudflare Pages app. |
| Authentication | Live | Supabase sign-in, password reset, role loading, and protected routes work. |
| Legacy authorization | Live | Owner, employee, and customer route rules plus core RLS policies. |
| Client management | Live foundation | Create/edit clients, contacts, portal settings, and activation links. |
| Customer portal | Live foundation | Customer-scoped portal and agency preview entry point. |
| Notifications | Live foundation | Persisted rows, RLS, popover states, mark-read, and onboarding producers. |
| Google OAuth | Live | Authorized account, token refresh, and server-side validation. |
| GA4 | Live | Property mapping and real reporting metrics. |
| Search Console | Live | Site mapping and real clicks/impressions. |
| Business Profile | External gate | Google project quota remains 0 QPM pending API approval. |
| Reports | Live foundation | Preview, print/PDF workflow, download, and connected metrics. |
| Cloudflare deployment | Live | GitHub-connected production deployment and custom domain. |

## Phase status

- Phase 0 repository audit: complete.
- Phase 1 foundation: in progress; organization/RBAC/audit/outbox migration and the real-data Today experience are implemented locally and pending production migration/deployment verification.
- Phases 2–11: planned, not production-complete.

## Verified baseline

On 2026-08-25: 14 unit tests passed, application TypeScript passed, Cloudflare Function TypeScript passed, and the Next.js production build generated 12 static routes, including the new `/today/` operating brief.

## Known limitations

- Tenant authorization still primarily uses `profiles.role` and `profiles.client_id` until organization migration is applied and consumed.
- Team invitation controls in Settings are not yet a complete server-backed workflow.
- Some preferences remain browser-local and are not yet portable across devices.
- Business Profile metrics cannot load until Google grants API quota.
- CRM, jobs, communications, AI, opportunities, automations, billing, and support are roadmap capabilities, not live features.
- Reports are live but still need persisted snapshots, provenance display, scheduled delivery, and broader tests.
