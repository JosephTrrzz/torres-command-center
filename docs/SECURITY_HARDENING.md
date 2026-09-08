# Torres OS production security baseline

Updated 2026-09-07.

No public application can be guaranteed attack-proof. This baseline uses independent controls so one failure does not expose the system: Cloudflare edge filtering, strict browser policy, bounded Functions, Supabase authentication and RLS, signed provider callbacks, private storage, least-privilege secrets, and auditable server-side changes.

## Repository controls

- `public/_headers` protects static Pages responses with CSP, HSTS, anti-framing, MIME-sniffing, referrer, permission, and cross-origin policies. Pages preview deployments are marked `noindex`.
- `functions/_middleware.ts` independently protects Function responses because Cloudflare does not apply `_headers` rules to Pages Functions. It also blocks TRACE, TRACK, and CONNECT; limits normal API mutation bodies to 1 MB; limits private attachment uploads to 10 MB; and rejects compressed mutation bodies.
- Supabase password sign-in and recovery accept a one-time Cloudflare Turnstile token. The public site key is browser-visible; its secret belongs only in Supabase Auth.
- Sign-in sessions default to browser-session storage. Persistent storage requires an explicit “Keep me signed in on this device” choice.
- `supabase/security_hardening.sql` removes legacy open customer-account and client-contact policies and replaces the website-chat read/update counter with one atomic, service-role-only claim.
- Public Formspree, Resend, Twilio, website-intake, calendar, unsubscribe, and receptionist routes retain their existing signature, opaque-token, exact-origin, expiry, idempotency, and scope checks.
- Torres AI remains behind a private service binding and uses HMAC, clock-skew checks, one-time durable nonces, timing-safe signature comparison, tenant-scoped retrieval, verified citations, and no action tools.

## Required production activation

Complete these controls for both `torrescotechnology.com` and `admin.torrescotechnology.com` where applicable.

1. Cloudflare DNS and TLS
   - Proxy the production hostnames through Cloudflare.
   - Use SSL/TLS mode **Full (strict)**, enable **Always Use HTTPS**, and keep the minimum TLS version at 1.2 or newer.
   - Enable DNSSEC and keep origin or deployment credentials out of DNS records and source control.
2. Cloudflare WAF
   - Enable the Cloudflare Managed Ruleset. Enable the OWASP Core Ruleset when the plan supports it, beginning in log/simulate mode and reviewing Security Events before blocking.
   - Add a rate-limiting rule for `POST /api/receptionist`: managed challenge at 20 requests per minute per IP for 10 minutes. The application independently caps accepted requests at 30 per minute per origin, IP, and session token.
   - Add a rate-limiting rule for other mutating `/api/*` requests: managed challenge or block above 60 requests per minute per IP, excluding signed provider webhooks and the protected integration scheduler.
   - Add stricter limits for repeated requests to `/login/` as a page, but rely on Supabase Turnstile for the actual password request because authentication is sent directly to Supabase.
3. Bot protection
   - On the public marketing site, enable Bot Fight Mode or the plan-equivalent bot protection and test the contact form and website chat.
   - Do not enable non-configurable Bot Fight Mode blindly on the Command Center domain: it can challenge provider webhooks and server-to-server calls. Prefer Super Bot Fight Mode or targeted custom/rate-limit rules that can explicitly exempt signed `/api/webhooks/*`, `/api/leads/website`, and `/api/integrations/scheduled` traffic.
4. Turnstile and Supabase Auth
   - Create a managed Turnstile widget restricted to `admin.torrescotechnology.com` and the intended Pages preview hostname only.
   - Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Cloudflare Pages.
   - In Supabase, open **Authentication → Bot and Abuse Protection**, enable CAPTCHA, select Cloudflare Turnstile, and save the matching secret key.
   - Require MFA for owners and administrators, enable leaked-password protection when available, set sensible password rules, and review active sessions after any credential incident.
5. Secrets and providers
   - Keep service-role, Resend, Twilio, Google, webhook, scheduler, website-intake, and Torres AI credentials in encrypted production secrets only.
   - Rotate credentials after suspected exposure and at a documented interval. Grant each provider only the scopes used by the application.
   - Never expose the Supabase service-role key, Turnstile secret, or internal HMAC credentials through `NEXT_PUBLIC_*` variables.
6. Monitoring and recovery
   - Review Cloudflare Security Events after activation and alert on sudden blocks, repeated 401/403/429 responses, webhook signature failures, and unusual geography.
   - Enable Supabase backups appropriate to the business recovery target and test a restore procedure before relying on it.
   - Keep an incident runbook: revoke sessions, rotate affected secrets, pause outbound campaigns, export audit evidence, restore known-good code, and notify affected parties when legally required.

## Safe deployment order

1. Apply `supabase/security_hardening.sql`.
2. Create the Turnstile widget and configure Supabase CAPTCHA plus the Cloudflare Pages public site key in the same maintenance window.
3. Deploy the application and verify login, recovery, website chat, attachments, webhooks, OAuth, reports, and the private client portal.
4. Turn on Cloudflare managed and rate-limit rules gradually while watching Security Events for false positives.
5. Run cross-tenant, unauthenticated, replay, oversized-body, and bot-rate smoke tests. Do not insert fake production customer records.
