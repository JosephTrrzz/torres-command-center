# Torres OS status

Updated 2026-09-21.

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
| Reports | Phase 5 normalized foundation | Preview, print/PDF workflow, download, normalized stored GA4/Search Console observations, visible freshness, and safe live fallback. |
| CRM | Live vertical slice | Organization-wide pipeline, client-linked lead capture, pinning, assignment, updates, appointments, follow-up tasks, activity history, secure first-party website intake with Formspree email notification, qualified website-chat transcripts with reversible archiving, and provider-tracked direct replies. |
| Operations | Phase 3 complete | Customer 360, locations, service jobs, scheduling, assignments, job activity, tasks, estimates, documents, shared calendar, customer-safe visibility, provider-tracked estimate approvals, and a revocable read-only Apple Calendar feed. |
| Shared inbox | Phase 4 vertical slice | Email and client-account conversations, profile-named agency/client replies, durable categories, reversible staff archiving, priorities, statuses, notifications, audit/outbox history, provider-backed email delivery, private attachments, and automatic signature/confidentiality notices. Qualified website chat is routed to its CRM lead record. |
| SMS and voice | Foundation ready to migrate | Explicit consent, suppression, SMS lifecycle events, signed Twilio webhook handling, provider readiness, and call-history schema are implemented. Live sending remains disabled until Twilio credentials and a sender are configured. |
| Campaigns and review requests | Phase 4B ready to migrate | Client-scoped drafts, consent basis, recipient review, durable suppression, staff test sends, explicit production confirmation, unsubscribe handling, and provider delivery truth. |
| Integration control | Phase 5 complete | Common provider registry, durable run history, manual verification, safe Google disconnect, scheduled health checks, normalized GA4/Search Console sync, signed webhook ingestion, two-failure administrator alerts, and recovery notices are implemented. |
| Torres AI | Retired | Navigation, route, API, Worker source, role permission, and runtime configuration are removed. Existing private database history is preserved without application access pending a separate retention decision. |
| Security hardening | Live foundation | Static and Function security headers, bounded edge requests, legacy customer-account RLS repair, atomic receptionist throttling, session-scoped default auth storage, and Supabase-validated Cloudflare Turnstile are active in production. Targeted WAF tuning and recurring monitoring remain operational follow-up work. |
| Cloudflare deployment | Live | GitHub-connected production deployment and custom domain. |

## Phase status

- Phase 0 repository audit: complete.
- Phase 1 foundation: complete for the controlled organization cutover. Legacy profile fields remain only as a compatibility fallback for unmigrated accounts.
- Phase 2 agency and client management: in progress; the membership-bound workspace selector and authorized client preview flow are implemented.
- Phase 3 CRM and operations: implementation complete; the lead-to-appointment workflow now continues into customer 360, jobs, scheduling, estimates, documents, tasks, activity, and client-visible approvals.
- Phase 4 communications and marketing: in progress; the secure shared Inbox, verified Resend provider, signed delivery webhook, branded transactional emails, private draft attachments, automatic legal footer, automatic lead acknowledgments, CRM replies, controlled campaigns/newsletters/review requests, consent-safe SMS/voice foundation, AI receptionist-to-CRM handoff, and the website chat availability control are implemented. Live Twilio provider configuration remains.
- Phase 5 integrations and normalization: complete for the launch provider-control and Google normalization vertical slice. Optional provider expansion remains additive future work.
- Phase 6 reporting delivery: implementation complete.
- Phase 7 Torres AI: retired from the product. Production cleanup is complete: the Pages service binding and runtime secret are removed, the private Worker is deleted, and the Supabase retirement migration has revoked application access while retaining historical records.
- Phases 8–11: planned, not production-complete.

The website receptionist is the only approved AI feature. Its public chat, CRM lead handoff, staff replies, and availability settings remain supported. Settings role descriptions no longer advertise retired AI access, and future phases must not reintroduce other AI features without a new owner decision.

## Verified baseline

The current baseline is re-verified after the Torres AI removal with application/security tests, both TypeScript checks, dependency audit, and the Next.js production build. The retirement migration preserves historical AI records while revoking application access.

## Known limitations

- Some legacy routes and browser data helpers still use `profiles.role` and `profiles.client_id`; protected Google, reports, and invitation Functions now prefer organization memberships and retain a compatibility fallback for unmigrated accounts.
- Invitation links are generated securely by Supabase, delivered through the provider-backed email ledger, and retained for private manual fallback. Provider rejection is shown honestly instead of being labeled sent.
- Some preferences remain browser-local and are not yet portable across devices.
- Business Profile metrics cannot load until Google grants API quota.
- Operational documents currently use validated HTTPS resource links; managed file uploads and storage lifecycle controls remain a later enhancement.
- Apple Calendar is a read-only subscription and Apple controls its refresh interval. Two-way Apple event import and editing are not enabled.
- Secure in-app communications, branded transactional email, controlled campaign/review-request delivery, the AI receptionist, and the consent-safe SMS/voice data and webhook foundation are implemented. Qualified website chats are retained as private CRM transcripts and staff replies pause the AI for that conversation. Live SMS/voice delivery requires Twilio credentials and a verified sender.
- Existing Torres AI database history is retained but unavailable to application roles. A separate retention decision is required before those historical rows are deleted. Opportunities, automations, billing, and support remain roadmap capabilities.
- Reports now use persisted daily Google observations with visible freshness. Comparison periods, scheduled delivery, and broader end-to-end production tests remain.
- Website lead storage is implemented. Production website delivery uses a first-party Cloudflare Function because outbound Formspree webhooks require a paid plan; both Pages projects require the shared server-only intake variables.

## Website Studio security follow-up — 2026-11-10

Added origin and Fetch Metadata checks for private Website API routes, before request body/storage processing. Authentication and assigned-website restrictions remain mandatory. Malformed non-object save envelopes are explicitly rejected. Verified 229 tests, production build, and both TypeScript checks. No publishing endpoint or new database permissions introduced. This is a targeted code review, not a full penetration test or verification of production WAF/database settings.

Session hardening adds provider logout, cross-tab logout notification, cached-page concealment, and fresh sign-in on browser history return. Verification is recorded with the release; this does not claim universal attack protection or immediate invalidation of already issued bearer tokens.

### Website Studio text resizing — November 10, 2026
Added eight edge/corner grips for existing text, inline text width/wrapping support, and handle selection retention. Selected color controls reflect actual text and object colors. Local browser checks covered keyboard resizing, inline typing, and Undo; user confirmed the preview works. This release excludes the unfinished publication workflow.

## Local Website Studio selection refinement — November 10, 2026

Refined the local multi-selection implementation after user feedback: Shift-selected groups no longer require a mode switch before movement, new objects drag directly in selection mode, empty-canvas marquees work in ordinary editing, and four-pixel pointer tolerance avoids accidental movements. Added shared selection bounds, a move handle, and keyboard nudges. Existing private draft storage and lock persistence remain unchanged. Local interaction regression suite: 242 tests passed. Not deployed.

### Selection coverage follow-up

Expanded local selection to rich text blocks, icon buttons, media and shared header/footer content. Verified mixed text/button/photo selection and movement in the browser, and a header lock surviving navigation from Home to About. Added rich-text deduplication and shared-key regression coverage: 244 tests passed. No deployment performed.

Local marquee repair: unselected text/images now start a selection rectangle in Select multiple mode; selected items retain group movement. A real browser mouse drag selected three items in the hero. Screenshot: /tmp/studio-marquee-fixed.png. Not deployed.

Local selection styling: added surrounding pasteboard drag forwarding into the sandboxed preview and selection-anchored gold/beige toolbar. Desktop selection visual reviewed; 246 tests, both TypeScript checks, changed-script lint, and production build pass. Local only. This slice does not add persistent grouping, group duplication/deletion, or group resizing.

Canva-reference selection flow follow-up: removed the selection-mode switch, added compact Group/Ungroup and lock controls, and persisted page-scoped groups in existing private draft JSON. Browser checks confirmed grouped text reselects together after a saved reload and lock/unlock updates the same group. 247 tests, both TypeScript checks and production build passed. Local preview only; no deployment. Group resize, duplication and deletion are not included in this slice.

### Connected draft reliability — November 10, 2026
Autosave confirms success only after the account bridge acknowledges persistence and follows up with edits made during an in-flight request. Transient failures keep the draft dirty and explain the Save draft retry action; reconnect retries autosave without creating a checkpoint. Authentication, permission and revision conflicts block retries rather than overwriting newer work. Restore now makes the workspace inert during capture/fetch/checkpoint, preventing concurrent edits from being lost. Missing authentication is classified as 401. Existing client-scoped API and six-checkpoint migration are unchanged. Added six connection-state regression tests; 255 tests pass. These changes are local and have not been production-validated or deployed.

## Website publishing control plane — 2026-11-10

Local implementation adds an assigned-site publishing review/button, immutable
release ledger migration, atomic revision/idempotency reservation, private adapter
boundary and all-route live-marker verification. Activation is blocked until the
current public site's safe renderer/deployment adapter is implemented and connected.
The SQL migration is not applied, and no public-site content has been published.
See `WEBSITE-PUBLISHING.md` for the contract and concrete activation requirements.


## Publishing reconciliation hardening — 2026-11-10

Local branch `codex/secure-publishing` combines the deployed editor baseline with
the publishing control plane. Added a private bounded scheduler endpoint and
prepared a two-minute Supabase Vault/cron migration. Reconciliation uses a fenced
database lease and the claimed row; canonical public pages must show the exact
release before Now Live. Closing review while polling restores editor interaction.

Activation remains blocked: the safe source-aware renderer and durable deployment
adapter are not installed, and the permanent provider connection is not configured.
Cloudflare dashboard access was restored. No public site content has changed.
Local tests at the implementation checkpoint: 294 pass.

### Production publishing prerequisites — November 10, 2026

The user saved the approved Pages publishing token as the encrypted production
secret `STUDIO_CLOUDFLARE_API_TOKEN` in `torres-command-center-app`. Storage was
verified in Cloudflare; no deployed adapter has validated or consumed it yet.
Applied `studio_publications.sql` and `studio_publication_scheduler.sql` to
production Supabase. Verified: RLS enabled, browser SELECT and begin-publication
EXECUTE denied, one cron job, zero enabled sites, and all 26 draft revisions
preserved. The scheduler credential is intentionally not installed yet.

Reran publishing, reconciliation, own-site, and request-security tests: 61 passed.
This is NOT an end-to-end publication/rollback test. The private adapter and
source-aware public renderer remain unimplemented. The Push to live site button
must remain unavailable until these are implemented and preview-tested. A Pages
rebuild of the current Git branch alone would not apply Supabase visual patches.


### 2026-11-10 publishing recovery and artifact checkpoint

Local implementation now includes strict draft preflight, a source-pinned compiler
for the two saved revision-26 geometry changes, a pure all-eleven-route export
packager, and assigned-admin-only encrypted-credential diagnostics. Recovery queries
existing hashed releases before rereading drafts, preserving ambiguous deployment
locks. The production publishing migrations are installed, but automatic publication
remains disabled pending the durable build/deployment adapter and preview/rollback
verification. Saved drafts and public website content have not been published by
this checkpoint.
