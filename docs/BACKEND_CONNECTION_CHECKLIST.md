# Backend connection checklist

Updated 2026-08-25.

Use this checklist before calling a backend or provider production-ready.

## Shared requirements

- [ ] Production owner and support contact recorded.
- [ ] Production and preview credentials separated.
- [ ] Required environment variables documented in `.env.example`.
- [ ] Secrets stored server-side and absent from the browser bundle.
- [ ] OAuth callback or webhook URL uses the production custom domain.
- [ ] Provider scopes are minimal and documented.
- [ ] Connection verification checks the provider, not only stored tokens.
- [ ] Resource discovery and mapping are tenant-scoped.
- [ ] RLS and Function authorization tests cover cross-tenant access.
- [ ] Loading, empty, permission, expired-token, rate-limit, and provider-error states exist.
- [ ] Sync freshness and last error are visible.
- [ ] Disconnect revokes or deletes credentials safely.
- [ ] Audit and outbox events are written for important changes.
- [ ] Logs redact credentials and sensitive payloads.
- [ ] Production smoke test and recovery procedure recorded.

## Supabase

- [x] Project URL and publishable key configured in Cloudflare.
- [x] Service-role key stored as a Cloudflare secret.
- [x] Auth, profiles, clients, portal accounts, Google mappings, and notifications live.
- [x] Core RLS enabled.
- [ ] Apply and verify `supabase/torres_os_foundation.sql`.
- [ ] Add cross-tenant database tests for organization-owned tables.
- [ ] Configure owner MFA policy.
- [ ] Test backup restoration and account deletion/export procedures.

## Google

- [x] OAuth client ID and secret configured.
- [x] Production and fallback redirect URIs configured.
- [x] GA4 property discovery and report API working.
- [x] Search Console site discovery and metrics working.
- [ ] Google Business Profile API access approved and quota greater than 0 QPM.
- [ ] Business Profile location mapping verified after approval.
- [ ] Disconnect and reauthorization flow tested.

## Cloudflare

- [x] GitHub repository connected to the Pages project.
- [x] Production branch configured.
- [x] Custom admin domain and SSL active.
- [x] Pages Functions and required production variables deployed.
- [ ] Add application error/latency alerts.
- [ ] Add scheduled invocation mechanism for outbox/sync workers.
- [ ] Test rollback to the previous successful deployment.

## Planned providers

PageSpeed, Cloudflare telemetry, Square, email, SMS/voice, storage, and AI remain unchecked until their adapters, secrets, server routes, mapping, sync, errors, disconnect flow, tests, and production smoke checks are complete.
