# Backend connection checklist

Updated 2026-09-02.

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
- [x] Apply and verify `supabase/torres_os_foundation.sql`.
- [x] Protect team/customer invitation mutation behind organization-aware Functions.
- [x] Activate memberships only after an authenticated invitation session is accepted.
- [ ] Add cross-tenant database tests for organization-owned tables.
- [ ] Configure owner MFA policy.
- [ ] Test backup restoration and account deletion/export procedures.

## Google

- [x] OAuth client ID and secret configured.
- [x] Production and fallback redirect URIs configured.
- [x] GA4 property discovery and report API working.
- [x] Search Console site discovery and metrics working.
- [x] Apply `supabase/provider_metrics.sql` and verify tenant-scoped normalized observation storage.
- [x] Manual and six-hour scheduled GA4/Search Console synchronization share the protected adapter.
- [x] Verify normalized sync and visible report freshness in production after migration/deployment.
- [ ] Google Business Profile API access approved and quota greater than 0 QPM.
- [ ] Business Profile location mapping verified after approval.
- [ ] Disconnect and reauthorization flow tested.

## Cloudflare

- [x] GitHub repository connected to the Pages project.
- [x] Production branch configured.
- [x] Custom admin domain and SSL active.
- [x] Pages Functions and required production variables deployed.
- [ ] Add application error/latency alerts.
- [x] Add a protected scheduled invocation mechanism for integration health checks.
- [ ] Add scheduled consumers for the general event outbox and provider sync workloads.
- [ ] Test rollback to the previous successful deployment.

## Planned providers

PageSpeed, Cloudflare telemetry, Square, email, SMS/voice, storage, and AI remain unchecked until their adapters, secrets, server routes, mapping, sync, errors, disconnect flow, tests, and production smoke checks are complete.

## Apple Calendar

- [x] Use a revocable read-only iCalendar subscription; do not store Apple ID credentials.
- [x] Store only the SHA-256 hash of each high-entropy subscription token.
- [x] Restrict customer feeds to client-visible service work.
- [x] Include internal appointments and task deadlines only for staff subscriptions.
- [x] Record subscription creation and revocation in the audit ledger.
- [x] Apply `supabase/apple_calendar.sql`.
- [ ] Verify creation, Apple handoff, feed refresh, and revocation in production.
