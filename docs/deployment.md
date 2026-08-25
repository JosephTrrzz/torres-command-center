# Deployment

## Build

Cloudflare Pages builds the repository with `npm run build` and serves the generated static output plus `functions/api`. Automatic deployment is enabled from the configured production branch.

Before deployment, run tests, both TypeScript checks, `git diff --check`, and the production build. Then smoke-test login, role landing pages, client selection, Google setup states, reports, PDF preview/download, and customer activation.

## Environment

Set the values listed in `.env.example` in the appropriate Cloudflare Pages environment. Public keys may be exposed to the browser; service-role, OAuth secret, and provider credentials must be server-only secrets.

## Change control

Production changes must follow the verified path above, use an auditable commit, and preserve unrelated local work. Database migrations and provider authorization remain explicit operator actions; credentials must never be copied into source control or support logs.
