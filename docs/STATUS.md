# Torres OS status

Updated 2026-08-25.

## Production foundation

| Area | Status | Evidence |
| --- | --- | --- |
| Custom admin domain | Live | `admin.torrescotechnology.com` serves the Cloudflare Pages app. |
| Authentication | Live | Supabase sign-in, password reset, role loading, and protected routes work. |
| Organization authorization | Live cutover | Active memberships and role permissions now drive shell access and protected Google/report/customer-invite Functions, with legacy profile fallback for unmigrated accounts. |
| Client management | Live foundation | Create/edit clients, contacts, portal settings, and activation links. |
| Customer portal | Live foundation | Customer-scoped portal and agency preview entry point. |
| Workspace switching | Live foundation | Direct organization switching is active-membership-bound; agency client previews are explicitly labeled and leave the administrator session unchanged. |
| Notifications | Live foundation | Persisted rows, RLS, popover states, mark-read, and onboarding producers. |
| Google OAuth | Live | Authorized account, token refresh, and server-side validation. |
| GA4 | Live | Property mapping and real reporting metrics. |
| Search Console | Live | Site mapping and real clicks/impressions. |
| Business Profile | External gate | Google project quota remains 0 QPM pending API approval. |
| Reports | Live foundation | Preview, print/PDF workflow, download, and connected metrics. |
| Cloudflare deployment | Live | GitHub-connected production deployment and custom domain. |

## Phase status

- Phase 0 repository audit: complete.
- Phase 1 foundation: complete for the controlled organization cutover. Legacy profile fields remain only as a compatibility fallback for unmigrated accounts.
- Phase 2 agency and client management: in progress; the membership-bound workspace selector and authorized client preview flow are implemented.
- Phases 3–11: planned, not production-complete.

## Verified baseline

On 2026-08-25: 17 unit tests passed, application TypeScript passed, Cloudflare Function TypeScript passed, and the Next.js production build generated 12 static routes, including the `/today/` operating brief. The atomic Supabase migration completed successfully and verification returned 3 organizations, 2 organization memberships, 10 permissions, and 39 role-permission mappings. All 8 new foundation tables have RLS enabled with 11 policies, and the organization linkage columns exist on both `clients` and `profiles`. The authorization cutover adds organization membership resolution, permission checks on protected Functions, server-backed team invitations, customer membership creation, invitation acceptance, audited workspace switching, and audit events.

## Known limitations

- Some legacy routes and browser data helpers still use `profiles.role` and `profiles.client_id`; protected Google, reports, and invitation Functions now prefer organization memberships and retain a compatibility fallback for unmigrated accounts.
- Invitation links are generated securely by Supabase and presented to an administrator for delivery; branded transactional email delivery is not yet configured.
- Some preferences remain browser-local and are not yet portable across devices.
- Business Profile metrics cannot load until Google grants API quota.
- CRM, jobs, communications, AI, opportunities, automations, billing, and support are roadmap capabilities, not live features.
- Reports are live but still need persisted snapshots, provenance display, scheduled delivery, and broader tests.
