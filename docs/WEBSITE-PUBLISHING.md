# Website Studio publishing — implementation and activation gate

## Current status

The Command Center control plane and UI are implemented. **Live publishing is NOT
activated.** The migration is prepared, not yet applied. No public website files,
DNS, credentials, or draft contents were deployed by this change.

A source audit found `JosephTrrzz/torres-co-technology` now uses a Sites/Vinext
worker build, while this editor contains imported static snapshots. This release
must not replace the actual site's source with those snapshots. A site-specific
safe renderer and deployment adapter remain required; the repository does not
currently contain either. The private service binding is intentionally absent.

## Implemented path

Authenticated Website editor → existing parent bridge → `/api/website/publish`
→ own-site authorization → enabled source/snapshot check → readiness check
→ atomic Supabase release reservation → private deployment adapter
→ matching deployment receipt → exact release markers on all eleven live routes
→ persisted `live` state → **Now Live**.

The browser sends only action, saved revision, snapshot ID and a UUID request key.
The server loads the immutable saved draft itself. Actor and client come from the
verified account. It never accepts a public URL, repository, branch, HTML export,
provider credential, or client ID in the mutation body.

`studio_begin_publication` locks the site row, checks the newest revision, handles
retries, enforces one active publication per site and a 30-second start cooldown.
A 90-second database lease bounds repeated polling/delivery. The draft hash is
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
