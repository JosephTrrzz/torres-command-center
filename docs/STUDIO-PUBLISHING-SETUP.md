# Website Studio publishing setup

This checklist is operational evidence, not a feature flag shortcut. Supabase holds
saved drafts and release/build ledgers. GitHub holds reviewed source and the build
runner. Cloudflare builds and serves the resulting site.

## Current boundaries

- Command Center: `torres-command-center-app`.
- First enrolled target: `torres-co-technology`, client
  `06edc104-71e0-4359-8cb3-42529d65b5d1`, `https://torrescotechnology.com`.
- Other clients remain unconnected until their own source mapping and deployment
  target are reviewed. An administrator choosing a client does not grant publishing.
- `STUDIO_CLOUDFLARE_API_TOKEN` stays only in Command Center's encrypted environment.
- `STUDIO_BUILD_INPUT_SECRET` is a separate server/build credential. It returns only
  approved artifacts for independently verified active deployment identities.
- `STUDIO_PUBLISHING_ENROLLMENT` must describe actual completed checks for the exact
  source commit. Never insert fabricated verification flags to make the button ready.

## Installation order

1. Apply the publications, scheduler and build-attempt migrations. Verify browser
   roles cannot read/write the private ledgers or invoke their transition functions.
2. Install the reviewed public runner and locked build tools described in
   `scripts/studio-source-build.md`. Include Next's stable generated configuration
   and ignore build tooling dependencies. Build with no tracked source drift.
3. Review the resulting public repository commit and explicitly update the server
   compiler/mapping pin. Deploy Command Center with the private build-input endpoint.
4. Keep adapter enrollment absent while an operator reserves a preview attempt for
   the actual reviewed Supabase revision. Persist the claim before dispatch, and
   persist the returned provider identity before allowing artifact retrieval.
5. Configure the reviewed build command, preserving all existing deployment settings.
   Verify the immutable preview's artifact, route markers, browser attestation and
   real navigation/form behavior. Do not submit contact forms as a smoke test.
6. Verify the recovery procedure against the captured production baseline. Only then
   install source-specific enrollment evidence and expose publishing to that site.
7. Configure the scheduler's matching encrypted credential in Supabase Vault and
   Command Center. Confirm that background reconciliation continues after the
   browser closes. No public scheduler invocation may mutate a release.
8. Publish the reviewed saved revision, observe both preview and production attempts,
   and confirm all canonical public routes identify the release before “Now Live.”

## Failure handling

An uncertain provider create response remains locked. Investigate the actual provider
job before changing the ledger; never retry a creation blindly or delete the attempt.
Unsupported draft edits fail closed and remain saved. A new public source commit
requires review and a new source pin/enrollment check. Disabling enrollment blocks
new builds; it cannot cancel a provider build that was already dispatched.

Local compiler/unit tests are not a live publication or recovery test. The runner's
functional evidence covers its documented browser checks only; it does not prove
external contact delivery, payment providers, analytics or every possible interaction.
