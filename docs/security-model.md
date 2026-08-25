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

## Known follow-up hardening

The current static app stores the browser session using the existing Supabase client helper. A future security pass should move session transport to an HttpOnly cookie where the hosting model permits it, add request rate limits to auth-sensitive Functions, and add audit events for invitations, integration changes, and report exports.

Never put real secrets in `.env.example`, GitHub, browser bundles, screenshots, or support tickets.
