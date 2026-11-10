# Website Studio production release — 2026-11-09

Isolated from production a30e660. Includes Website home, visual canvas, private draft
API, assigned-site access guard, Today/client Home entry, navigation and required
frame headers. Preserves production reporting, invitations, client forms and other
unrelated local work. No public website consumer or draft publication is enabled.

Database prerequisites already applied to mfdunybyzpfjqziygulk:
studio_account_compatibility.sql and studio_canvas_drafts.sql. The Torres site
assignment is enabled with the packaged snapshot. Existing client access uses
active memberships. Agency admins require an explicit own-site profile assignment;
missing assignments fail closed rather than defaulting to the Torres site.

Release suite: 200 tests pass, including own-site read/write denial for owner,
admin and client roles. Both TypeScript checks pass. A production-configured build
is required; the original checkout's local-fixture out directory must not deploy.
Real-account editing requires a signed-in user for final end-to-end verification.
