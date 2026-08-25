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
| CRM | Live vertical slice | Client-scoped lead capture, assignment, pipeline updates, appointments, follow-up tasks, and activity history. |
| Cloudflare deployment | Live | GitHub-connected production deployment and custom domain. |

## Phase status

- Phase 0 repository audit: complete.
- Phase 1 foundation: complete for the controlled organization cutover. Legacy profile fields remain only as a compatibility fallback for unmigrated accounts.
- Phase 2 agency and client management: in progress; the membership-bound workspace selector and authorized client preview flow are implemented.
- Phase 3 CRM and operations: in progress; the lead-to-appointment vertical slice is implemented and production-migrated.
- Phases 4–11: planned, not production-complete.

## Verified baseline

On 2026-08-25: 27 unit tests passed, application TypeScript passed, Cloudflare Function TypeScript passed, and the Next.js production build generated 15 static routes, including `/today/`, `/projects/`, and `/crm/`. The Phase 1 organization, Phase 2 onboarding/project delivery, and Phase 3 CRM migrations completed successfully. The CRM migration added four RLS-protected tenant tables and two permission keys without seeded demo records. Protected Functions now cover organization access, invitations, onboarding, projects, reports, Google resources, and the lead-to-appointment CRM workflow.

## Known limitations

- Some legacy routes and browser data helpers still use `profiles.role` and `profiles.client_id`; protected Google, reports, and invitation Functions now prefer organization memberships and retain a compatibility fallback for unmigrated accounts.
- Invitation links are generated securely by Supabase and presented to an administrator for delivery; branded transactional email delivery is not yet configured.
- Some preferences remain browser-local and are not yet portable across devices.
- Business Profile metrics cannot load until Google grants API quota.
- CRM has a production lead-to-appointment foundation; customer 360 expansion, jobs, estimates, documents, and broader calendar workflows remain planned.
- Communications, AI, opportunities, automations, billing, and support are roadmap capabilities, not live features.
- Reports are live but still need persisted snapshots, provenance display, scheduled delivery, and broader tests.
