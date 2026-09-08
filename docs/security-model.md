# Security model

## Roles and scope

Profiles carry `owner`, `employee`, or `customer`. Owners and employees are staff users. Customers may access only their assigned client and only the customer portal. The signed-in profile is loaded server-side from Supabase before privileged Function work proceeds.

## Enforced controls

- Protected routes redirect by role through `lib/access-control.ts` and the app shell.
- Supabase RLS protects profiles, clients, client people, customer accounts, and future notification rows.
- `/api/reports` requires a bearer token and rejects a customer requesting a different client.
- Google status/property Functions require an authenticated staff user before service-role access.
- Google OAuth start requires an authenticated staff user, and callback state, client, and PKCE verifier are short-lived HttpOnly cookies.
- Refresh tokens and service-role credentials remain server-side.
- Static and Function responses carry explicit anti-framing, CSP, HSTS, MIME-sniffing, referrer, permission, and cache controls.
- Edge middleware rejects TRACE/CONNECT/TRACK, compressed mutation bodies, and oversized API bodies before route logic runs.
- Password sign-in and recovery can require a Supabase-validated Cloudflare Turnstile token.
- Website receptionist throttling uses one atomic database claim so parallel bot requests cannot race the counter.

## Known follow-up hardening

The current static app must keep its Supabase token readable by the browser. Unchecked sign-ins now use session-only storage, while the explicit trusted-device option uses persistent storage. Moving all session transport to an HttpOnly cookie requires a deliberate hosting/auth architecture change. Cloudflare zone-level WAF, managed rules, bot protection, and rate-limiting rules must also be enabled in production; repository code cannot prove those dashboard controls are active.

Never put real secrets in `.env.example`, GitHub, browser bundles, screenshots, or support tickets.
