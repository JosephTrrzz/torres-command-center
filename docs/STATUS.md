# Torres OS status

Updated 2026-08-28.

## Production foundation

| Area | Status | Evidence |
| --- | --- | --- |
| Custom admin domain | Live | `admin.torrescotechnology.com` serves the Cloudflare Pages app. |
| Authentication | Live | Supabase sign-in, password reset, role loading, and protected routes work. |
| Organization authorization | Live cutover | Active memberships and role permissions now drive shell access and protected Google/report/customer-invite Functions, with legacy profile fallback for unmigrated accounts. |
| Client management | Live foundation | Create/edit clients, contacts, portal settings, and provider-tracked activation emails with secure-link fallback. |
| Customer portal | Live foundation | Customer-scoped portal and agency preview entry point. |
| Workspace switching | Live foundation | Direct organization switching is active-membership-bound; agency client previews are explicitly labeled and leave the administrator session unchanged. |
| Notifications | Live foundation | Persisted rows, RLS, popover states, mark-read, and onboarding producers. |
| Google OAuth | Live | Authorized account, token refresh, and server-side validation. |
| GA4 | Live | Property mapping and real reporting metrics. |
| Search Console | Live | Site mapping and real clicks/impressions. |
| Business Profile | External gate | Google project quota remains 0 QPM pending API approval. |
| Reports | Live foundation | Preview, print/PDF workflow, download, and connected metrics. |
| CRM | Live vertical slice | Client-scoped lead capture, assignment, pipeline updates, appointments, follow-up tasks, and activity history. |
| Operations | Phase 3 complete | Customer 360, locations, service jobs, scheduling, assignments, job activity, tasks, estimates, documents, shared calendar, customer-safe visibility, and provider-tracked estimate approvals. |
| Shared inbox | Phase 4 vertical slice | Client-scoped secure conversations, agency/client replies, priorities, statuses, notifications, audit/outbox history, provider-backed email delivery, private attachments, and automatic signature/confidentiality notices. |
| SMS and voice | Foundation ready to migrate | Explicit consent, suppression, SMS lifecycle events, signed Twilio webhook handling, provider readiness, and call-history schema are implemented. Live sending remains disabled until Twilio credentials and a sender are configured. |
| Campaigns and review requests | Phase 4B ready to migrate | Client-scoped drafts, consent basis, recipient review, durable suppression, staff test sends, explicit production confirmation, unsubscribe handling, and provider delivery truth. |
| Cloudflare deployment | Live | GitHub-connected production deployment and custom domain. |

## Phase status

- Phase 0 repository audit: complete.
- Phase 1 foundation: complete for the controlled organization cutover. Legacy profile fields remain only as a compatibility fallback for unmigrated accounts.
- Phase 2 agency and client management: in progress; the membership-bound workspace selector and authorized client preview flow are implemented.
- Phase 3 CRM and operations: implementation complete; the lead-to-appointment workflow now continues into customer 360, jobs, scheduling, estimates, documents, tasks, activity, and client-visible approvals.
- Phase 4 communications and marketing: in progress; the secure shared Inbox, verified Resend provider, signed delivery webhook, branded transactional emails, private draft attachments, automatic legal footer, controlled campaigns/newsletters/review requests, and consent-safe SMS/voice foundation are implemented. Live Twilio provider configuration and AI receptionist workflows remain.
- Phases 5–11: planned, not production-complete.

## Verified baseline

On 2026-08-28: the unit suite, application TypeScript, Cloudflare Function TypeScript, and Next.js production build passed. The communications, transactional-email, attachment, marketing, and SMS/voice migrations create no seeded conversations, messages, deliveries, provider events, calls, or files.

## Known limitations

- Some legacy routes and browser data helpers still use `profiles.role` and `profiles.client_id`; protected Google, reports, and invitation Functions now prefer organization memberships and retain a compatibility fallback for unmigrated accounts.
- Invitation links are generated securely by Supabase, delivered through the provider-backed email ledger, and retained for private manual fallback. Provider rejection is shown honestly instead of being labeled sent.
- Some preferences remain browser-local and are not yet portable across devices.
- Business Profile metrics cannot load until Google grants API quota.
- Operational documents currently use validated HTTPS resource links; managed file uploads and storage lifecycle controls remain a later enhancement.
- Secure in-app communications, branded transactional email, controlled campaign/review-request delivery, and the consent-safe SMS/voice data and webhook foundation are implemented. Live SMS/voice delivery requires Twilio credentials and a verified sender; AI receptionist workflows remain roadmap capabilities.
- AI, opportunities, automations, billing, and support are roadmap capabilities, not live features.
- Reports are live but still need persisted snapshots, provenance display, scheduled delivery, and broader tests.
