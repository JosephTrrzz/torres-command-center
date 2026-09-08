# Deployment

## Build

Cloudflare Pages builds the repository with `npm run build` and serves the generated static output plus `functions/api`. Automatic deployment is enabled from the configured production branch.

Before deployment, run tests, both TypeScript checks, `git diff --check`, and the production build. Then smoke-test login, role landing pages, client selection, Google setup states, reports, PDF preview/download, and customer activation.

For the security release, apply `supabase/security_hardening.sql` before deploying the matching receptionist code. Then follow the production activation order in [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md). Configure the Turnstile public site key and Supabase CAPTCHA secret together; setting only one side either provides no bot protection or prevents legitimate authentication.

## Environment

Set the values listed in `.env.example` in the appropriate Cloudflare Pages environment. Public keys may be exposed to the browser; service-role, OAuth secret, and provider credentials must be server-only secrets.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is intentionally public. Its matching secret is configured only in **Supabase Authentication → Bot and Abuse Protection**, never in source or a `NEXT_PUBLIC_*` variable.

## Torres AI activation

1. Apply `supabase/torres_ai.sql` in Supabase. It creates no example conversations or messages.
2. From `workers/torres-ai`, create a cryptographically random secret of at least 32 bytes and save it with `wrangler secret put TORRES_AI_INTERNAL_SECRET`. Save the exact same value as the encrypted `TORRES_AI_INTERNAL_SECRET` secret in the Command Center Pages production environment. Do not paste the value into source, SQL, logs, screenshots, or browser variables.
3. Deploy the `torres-ai` Worker. Public workers.dev and preview URLs remain disabled.
4. In the Command Center Pages project, add a Service binding named `TORRES_AI` targeting the `torres-ai` Worker, then redeploy Pages.
5. Keep AI Gateway payload logging disabled. If a gateway is used, set only its non-secret ID as `AI_GATEWAY_ID` on the Worker.
6. Smoke-test with two different users and two different organizations. Confirm each user sees only their own threads and permitted tenant records, unsafe citation URLs are absent, an unauthenticated `/api/ai/` request returns 401, and no prompts or answers appear in Worker or AI Gateway logs.

Rotation: create a new random secret, update both encrypted locations during one maintenance window, redeploy the Worker and Pages project, verify one cited answer, then remove any superseded deployment. The browser never receives this secret.

For automated integration health, generate one random credential of at least 32 bytes. Save it as `INTEGRATION_CRON_SECRET` in Cloudflare and as `integration_scheduler_secret` in Supabase Vault. Save `https://admin.torrescotechnology.com/api/integrations/scheduled` as the Vault entry `integration_scheduler_url`, then redeploy so the protected Function receives the Cloudflare value. Never place the credential in source, browser code, migration SQL, screenshots, or logs.

## Change control

Production changes must follow the verified path above, use an auditable commit, and preserve unrelated local work. Database migrations and provider authorization remain explicit operator actions; credentials must never be copied into source control or support logs.
