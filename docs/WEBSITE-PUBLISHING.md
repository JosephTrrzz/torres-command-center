# Website Studio publishing — implementation and activation gate

## Current status

The Command Center control plane and UI are implemented. **Live publishing is NOT
activated.** `studio_publications.sql` and `studio_publication_scheduler.sql`
were applied to production Supabase project `mfdunybyzpfjqziygulk` on
2026-11-10. Verification confirmed publication RLS is enabled, authenticated
browser roles cannot select the ledger or execute the begin function, exactly
one scheduler job exists, and zero sites have publishing enabled. All 26 saved
draft revisions remain present. The scheduler has no configured invocation
secret yet and therefore remains dormant.

The user saved `STUDIO_CLOUDFLARE_API_TOKEN` as an encrypted production secret
in `torres-command-center-app`; Cloudflare's settings UI confirmed encrypted
storage. Its validity has not been tested by a deployed publishing service.
No public website files, DNS, or draft contents were published by this change.

A source audit found `JosephTrrzz/torres-co-technology` contains both Next export
and Sites/Vinext tooling. The inspected Cloudflare Pages production deployment
uses `npx next build` with `out`, at source commit
`3733811fd7ddab2cd25a4a62585c9b5d860076a3`. The editor contains imported static snapshots. This release
must not replace the actual site's source with those snapshots. A site-specific
safe renderer and deployment adapter remain required. A narrow, locally tested compiler and
all-route packager now cover the two geometry edits present in saved revision 26;
they are not yet connected to a deployed build runner. The private service binding is intentionally absent.

## Implemented path

Authenticated Website editor → existing parent bridge → `/api/website/publish`
→ own-site authorization → enabled source/snapshot check → readiness check
→ atomic Supabase release reservation → private deployment adapter
→ matching deployment receipt → exact release markers on all eleven canonical live routes (no cache-busting query)
→ persisted `live` state → **Now Live**.

The browser sends only action, saved revision, snapshot ID and a UUID request key.
The server loads the immutable saved draft itself. Actor and client come from the
verified account. It never accepts a public URL, repository, branch, HTML export,
provider credential, or client ID in the mutation body.

`studio_begin_publication` locks the site row, checks the newest revision, handles
retries, enforces one active publication per site and a 30-second start cooldown.
A 90-second database lease bounds repeated polling/delivery; updates are fenced by that exact lease value, and work resumes from the claimed database row. The draft hash is
canonical SHA-256. Release identity is immutable; status transitions cannot move
backward or rewrite finished jobs. Anonymous/authenticated database access is
revoked. Failed or ambiguous requests never display success. Ambiguous delivery
is reconciled using the same release ID, not a new deployment.

Restoring one of the six saved drafts creates a new revision; publishing that
revision is the user-facing rollback path. The provider must also retain its last
good deployment and keep it serving during failed builds.

## Required private adapter contract (not implemented yet)

Install a private Cloudflare Worker bound as `STUDIO_PUBLISHER`. Do not expose its
mutating handlers publicly. Provider credentials stay inside the adapter and are
restricted to the approved source repository/site. The adapter is a trusted code
boundary: a capability flag alone is not a security review.

- `GET /capabilities?client=<uuid>` returns protocol 1, exact clientId,
  snapshotId, publicUrl, and safeRenderer/durableIdempotency/rollback=true ONLY
  after this client's renderer and deployment path have been installed and tested.
- `POST /releases` receives protocol, releaseId, clientId, snapshotId, revision,
  contentHash, publicUrl and draft. Bind the client to an operator-approved target;
  independently verify the hash and schema. Persist the release ID BEFORE starting
  durable build/deploy work. Repeated identical requests return the same deployment;
  altered content under an existing release ID must fail.
- `GET /releases/<id>?client=<uuid>` reads that scoped durable job.
- Responses repeat releaseId/clientId/snapshotId/revision/contentHash/deploymentId,
  with status queued, building, deploying, succeeded or failed. Never accept a
  browser-supplied callback to set these values.
- Emit `<meta name="torres-studio-release" content="<releaseId>:<contentHash>">`
  inside the first 64 KB of the head on EVERY supported route, as part of the actual
  deployed artifact. It must not be a standalone marker disconnected from content.
- Keep provider rollback, previous artifact, and build failures auditable. A stuck
  job is reconciled or marked failed by the provider; never silently expire a job
  that might still deploy later.

The renderer must explicitly support all current editor patches: stable element
identifiers, shared header/footer, text/styles, image replacements/crops, inserted
shapes/text, new/copied sections, and button styles. Whitelist properties and URL
schemes, escape text, validate image signatures/sizes, strip active markup, reject
unsupported fields and reject source drift. **The generic private draft validator
is not an HTML sanitizer and must never be used as one.** Do not execute editor
scripts or import arbitrary draft CSS/HTML into the public site. Preserve working
forms, routing, receptionist, CSP, analytics, and responsive behavior.

## Activation sequence

1. Implement and validate the above renderer against the current public-site source.
2. Apply `supabase/studio_publications.sql` after the draft migrations. It defaults
   all sites to publishing disabled and has no browser table/function grants.
3. Install the private adapter with a restricted deployment identity, bind it to
   Command Center, and enroll ONLY the matching assigned site.
4. Verify race/retry/failure and rollback behavior against a preview deployment.
5. Enable `studio_sites.publishing_enabled` for that site only after readiness passes.
6. Publish a deliberately reviewed revision; verify its content, all release markers,
   forms, links, mobile layout and previous-version recovery in production.

Production deployment, applied database grants, provider credentials, distributed
WAF limits, renderer behavior and end-to-end publication have NOT been verified by
this local control-plane change. Unit tests cover permissions, request shape,
source binding, hashing, lease behavior, mismatched receipts and marker verification.

## Background confirmation — implemented locally, activation pending

`/api/website/reconcile` uses a separate scheduler credential and accepts no
browser-supplied client, URL, draft, or status. It reads up to three due authorized
releases and invokes the same leased reconciliation function as the editor.
The additive `supabase/studio_publication_scheduler.sql` schedules this every two
minutes using Vault; it makes no request without the scheduler secret and due work.
No publishing enrollment is enabled by this migration.

Set Vault `studio_publication_scheduler_secret` and matching encrypted Cloudflare
`STUDIO_CRON_SECRET` only when the private deployment adapter is ready. The
scheduler does not replace the adapter's durable job or cancellation guarantees.
A timeout must never unlock a release that might still deploy. Provider-confirmed
failure remains required before permitting a replacement release.

The actual public URLs must serve release markers; a successful deployment or a
fresh cache-busted response alone cannot produce Now Live. Existing publication
review can be closed during a status check without leaving the editor inert.

Remaining implementation: safe site-specific renderer with source-drift checks,
private durable deployment adapter, restricted provider connection, preview
publication/rollback verification, then per-site activation. These are NOT
completed by the control-plane or scheduler changes. No saved draft was published.


## 2026-11-10 — source adapter and recovery checkpoint

- Added strict publication preflight: unknown fields, active markup/URL schemes,
  malformed raster uploads and unsupported copied sections fail closed.
- Added a source-pinned compiler for the currently saved home hero movement and
  introduction box geometry. Other meaningful edits fail explicitly; this is not
  a general renderer for all Website Studio features.
- Added a pure packager that checks all eleven real export routes before producing
  changed output, preserves unrelated files byte-for-byte, and rejects mismatched
  markers, source commits and content-addressed scripts.
- Added staff-only, assigned-site connection diagnostics that consume the encrypted
  Cloudflare credential only on the server and return no provider configuration.
  Valid credentials never activate publishing on their own.
- Recovery now looks up hashed queued releases before reading private drafts;
  only a definitive provider 404 permits another idempotent dispatch. Existing
  deployments can be observed even when draft storage is unavailable.
- Runtime geometry preserves existing absolute positioning. A static release
  marker is not sufficient to prove runtime edits were applied: the missing build
  runner must validate the actual rendered preview, CSP/script delivery, functional
  forms and rollback before any production enrollment or capability advertisement.

Still pending: deployed durable provider adapter, trusted real-source build runner,
preview/browser application proof, rollback proof, scheduler credential and per-site
activation. No publication readiness or successful live publication is asserted.
