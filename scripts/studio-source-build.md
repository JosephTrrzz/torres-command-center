# Trusted public-source build gate

Copy `studio-source-build.mjs`, `studio-source-package.mjs`,
`studio-verify-export.mjs`, `package.json` and `package-lock.json` into the
public repository's `scripts/` directory. Keep the generation script in CC;
regenerate and review the portable packager whenever its source changes.
The portable bundle has no source commit literal. Commit the public runner
first, review that commit, then update the **server** compiler/source mapping
pin explicitly. The runner never changes the server pin.

Install the exact locked tooling and Chromium in the build environment:

```sh
npm ci --prefix scripts --ignore-scripts
node scripts/node_modules/playwright-core/cli.js install --with-deps chromium
node scripts/studio-source-build.mjs
```

The provider environment must support Playwright's Chromium dependencies and
loopback listening. Browser installation happens during trusted build setup,
not as an automatic fallback in the verifier. Do not set browser-download
credentials or build secrets as `NEXT_PUBLIC_*` variables.

The runner expects `CF_PAGES=1`, `CF_PAGES_URL` containing the immutable
8-hex deployment hostname, `CF_PAGES_COMMIT_SHA`, `CF_PAGES_BRANCH`,
`STUDIO_BUILD_ENVIRONMENT` (`preview` or `production`), and
`STUDIO_BUILD_INPUT_SECRET`. `STUDIO_BUILD_ATTEMPT_ID` is an optional additional
identity restriction. The preview branch is `codex/studio-publish-preview`;
production is `main`. The build-input endpoint is fixed in the runner.

Before building, source HEAD and environment must agree and the checkout must
be clean. Bootstrap sends only `{buildUrl,sourceCommit}` with a server-to-server
Bearer header. It retries only 409, at most six requests. This is authenticated
HTTPS, **not a signed artifact**; SHA-256 verifies integrity, not authorization.
Approval is fetched again after building and after browser verification and
must remain identical. Next runs as `npx --no-install next build`, without a
shell, with an allowlisted environment and no dotenv files. Next must be
16.2.6, including its installed executable. Existing `out` directories fail
closed; start from a fresh checkout/build directory.

Packaging preserves unrelated export bytes, assets, functions source, routing
files and headers. It stages the export outside the checkout. The browser
verifier serves these actual staged bytes on loopback; it never serves editor
snapshot HTML or repairs a missing marker. It verifies:

- All eleven canonical routes at 1440px and 390px, their exact release markers,
  and successful loading of the exact digest-checked artifact script.
- Runtime success on changed routes, literal text/style/attribute results,
  image decode and movement geometry, and the nested `em` structure. No-op
  routes have no synthetic applied status. Checks repeat after interactions.
- Real menu open/Escape close handlers, every menu route link, and brand-link
  navigation back home with patch verification after navigation.
- Home/contact form action/method, required and hidden field contracts,
  field entry, live service selection, validity and retained values after menu
  interaction. Form/input/em nodes captured before load must remain connected.
- No horizontal overflow or clipped hero text/action bounds, uncaught/hydration errors, local asset failures or
  CSP violations during these checks.

All off-origin network requests and non-GET/HEAD requests are blocked. No
form is submitted, and contact delivery, provider Functions, third-party
integrations and all possible interactions are **not** covered by
`functionalVerified`. That flag means the explicit local checks above passed.

There is **no invented CSP**: absent `_headers` means no added CSP. Meta CSP is
honored naturally by Chromium. Supported `_headers` are local exact/wildcard
path rules with literal header values. Header removal/substitution/absolute
host rules and special transport headers fail closed. `_redirects` supports
simple literal local redirects with standard redirect status codes; rewrites,
substitutions and other syntax fail closed. Redirecting a canonical route fails
the direct-route check. Files are preserved regardless. Provider-injected
headers/Functions routing cannot be reproduced by this local static server and
need independent deployment checks.

Only after browser success, unchanged staged bytes, and refreshed approval does
the runner write `_studio/verification.json` with protocol 1, exact attempt,
deployment, release, content hash, source commit, artifact hash, and all three
verification booleans true. The verifier alone returns evidence and never
writes proof. An old proof is rejected. There is no CLI skip flag. The staged
export replaces `out` only after source/functions/output consistency checks;
failures leave no runner-created proof in `out`. Browser errors are reported
with a static error code; artifact text and credentials are not logged.

The provider adapter must still independently retrieve the deployed proof and
all route markers and compare every identity/hash after provider success.
This runner does not deploy, mark anything live, or update readiness flags.

For a separate diagnostic run against an already packaged real export, supply
the approved build-input response (without credentials) as a local JSON file:

```sh
node scripts/studio-verify-export.mjs --out /path/to/staged/out --expected /path/to/approved.json
```

This command does not authenticate source provenance and never writes a proof;
only the full trusted runner does that. Do not put the expected-input file in
`public` or `out`.

## Local regression tests

The browser tests use real Chromium, actual public Navigation/ContactForm/
ServiceSelect source at the pinned revision, React SSR/hydration, and the real
revision-36 compiler output. They are a generated export **fixture**, not a
Next build of the public repository. They cannot establish that the public
Next build passes. The test explicitly covers delayed hydration: patches wait for the trusted
route effect. Missing readiness, source drift, hydration errors and spoofed
applied-status attributes fail closed. Same-document Next router navigation
away and back is mandatory; the React fixture models that API only for tests.

```sh
STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright-core \
STUDIO_CHROME_PATH=/path/to/chrome \
npx vitest run tests/studio-source-build.browser.test.mjs tests/studio-source-package.test.mjs
```

Browser tests skip when Playwright is not installed/resolvable and no explicit
module is supplied; a broken explicitly supplied module fails. The production
runner never skips unavailable tooling or failed browser checks.
