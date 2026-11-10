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

## Website Studio boundary — November 10, 2026

Website API routes reject mismatched Origin and cross-origin Fetch Metadata before body processing or storage. This supplements bearer authentication; headerless non-browser callers still require valid credentials. Both administrators and clients are restricted to their explicitly assigned website. Enabled-site and approved-source checks precede draft reads/writes. Drafts are append-only, actor-attributed, revision-checked, size-bounded private records; saving is not publishing. Browser roles have no direct draft-table grants in the migration. Production grants and zone-level distributed rate limits require separate operational verification.

## Session exit and browser history — November 10, 2026

Explicit logout clears both browser stores immediately, notifies mounted screens, broadcasts to other open tabs, and requests Supabase global logout with a keepalive request. Browser Back/Forward history navigation with an active session, and restored back-forward-cache pages, require fresh sign-in. Cached authenticated shell content is hidden on page exit. Normal in-app links and ordinary reloads retain their existing behavior. A late profile refresh may not restore a cleared session.

Provider logout revokes refresh credentials; already issued bearer access tokens may remain valid until expiry. Network failure cannot guarantee provider revocation, but local access is still cleared. This does not replace short provider token lifetimes, MFA, server-side session revocation enforcement, or operational WAF configuration. These controls have not been claimed as verified in this change.
