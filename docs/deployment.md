# Deployment

## Build

Cloudflare Pages builds the repository with `npm run build` and serves the generated static output plus `functions/api`. Automatic deployment is enabled from the configured production branch.

Before deployment, run tests, both TypeScript checks, `git diff --check`, and the production build. Then smoke-test login, role landing pages, client selection, Google setup states, reports, PDF preview/download, and customer activation.

For the security release, apply `supabase/security_hardening.sql` before deploying the matching receptionist code. Then follow the production activation order in [`SECURITY_HARDENING.md`](./SECURITY_HARDENING.md). Configure the Turnstile public site key and Supabase CAPTCHA secret together; setting only one side either provides no bot protection or prevents legitimate authentication.

## Environment

Set the values listed in `.env.example` in the appropriate Cloudflare Pages environment. Public keys may be exposed to the browser; service-role, OAuth secret, and provider credentials must be server-only secrets.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is intentionally public. Its matching secret is configured only in **Supabase Authentication → Bot and Abuse Protection**, never in source or a `NEXT_PUBLIC_*` variable.

## Retired Torres AI cleanup

Apply `supabase/retire_torres_ai.sql` on databases where the former feature was installed. Remove the `TORRES_AI` Pages service binding and `TORRES_AI_INTERNAL_SECRET`, then delete the private `torres-ai` Worker after the application deployment no longer references it. The retirement migration preserves historical rows but revokes application access.

For automated integration health, generate one random credential of at least 32 bytes. Save it as `INTEGRATION_CRON_SECRET` in Cloudflare and as `integration_scheduler_secret` in Supabase Vault. Save `https://admin.torrescotechnology.com/api/integrations/scheduled` as the Vault entry `integration_scheduler_url`, then redeploy so the protected Function receives the Cloudflare value. Never place the credential in source, browser code, migration SQL, screenshots, or logs.

## Change control

Production changes must follow the verified path above, use an auditable commit, and preserve unrelated local work. Database migrations and provider authorization remain explicit operator actions; credentials must never be copied into source control or support logs.
