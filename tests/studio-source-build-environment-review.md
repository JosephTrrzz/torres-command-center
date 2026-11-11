# Source build environment review (no provider changes)

Reviewed 2026-11-10 against the installed Playwright Core 1.56.1 implementation
and official documentation. This is a compatibility assessment, not evidence
that a Cloudflare build ran Chromium.

- Cloudflare's current build image documentation lists Ubuntu 22.04.2/x86_64
  in gVisor. Playwright 1.56.1's `nativeDeps.js` includes
  `ubuntu22.04-x64`, so the OS/architecture pair is supported. The actual
  project image version must still be checked in its build log.
- `install --with-deps chromium` invokes `apt-get update` and installs OS
  libraries. The pinned `dependencies.js` implementation uses root directly,
  otherwise sudo, otherwise su. Successful noninteractive elevation and APT
  access in the provider build have NOT been demonstrated. Installing browsers
  without dependencies only works if all required libraries already exist.
  A provider build must install and successfully launch Chromium before this
  can be considered verified. The runner fails closed when launch is unavailable.
- Use `--only-shell` with this pinned Chromium setup if choosing a smaller
  download: the verifier uses headless Chromium with no explicit channel, which
  uses Chromium headless shell. Do not claim container/kernel compatibility
  based on the local macOS Chrome tests; gVisor still needs an actual launch test.
- Cloudflare Pages documents a 20-minute build limit. The current runner allows
  Next alone 20 minutes; three approval rounds can each take up to 65 seconds
  (six requests with 10-second timeouts plus five seconds backoff). The browser
  has 10-second per-action/navigation limits but NO global verifier deadline.
  Dependency/browser setup happens before the runner with no explicit timeout
  in the installation instructions. Therefore the current pipeline has no
  controlled overall duration below the provider limit; provider termination
  would fail the build, not produce verification proof.
- Before switching the provider command to the trusted runner, use a bounded
  setup/build budget, for example 4 minutes setup, 10 minutes Next, 3 minutes
  verification, and 2 minutes for identity/packaging/cleanup (19 minutes total).
  Enforce a shared deadline and terminate browser/Next descendants on expiration;
  per-action timeouts alone do not establish that bound. Account for provider
  automatic dependency installation before custom commands. These are proposed
  limits, not implemented or measured Cloudflare timings.

References:

- https://developers.cloudflare.com/pages/configuration/build-image/
- https://developers.cloudflare.com/pages/platform/limits/
- https://playwright.dev/docs/browsers
- https://playwright.dev/docs/ci

No provider configuration, source commit pin, installation branch, or deployment
was changed by this review.
