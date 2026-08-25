# Torres & Co. Command Center architecture

## Runtime

- Next.js 14 App Router renders the admin and customer-facing routes.
- The production frontend is a static export served by Cloudflare Pages.
- Server-only work lives in Cloudflare Pages Functions under `functions/api`.
- Supabase Auth owns identity and Supabase Postgres owns application data.
- Google OAuth tokens are stored only in the server-side `google_connections` table; browser code never receives refresh tokens.

## Boundaries

Browser components use the public Supabase URL and publishable/anon key for session-aware reads. Privileged operations go through Functions. Every Function that reads client-scoped data must validate the Supabase bearer token and the caller's role before using the service-role key.

The service-role key is never a `NEXT_PUBLIC_*` value and must exist only in Cloudflare production secrets. RLS remains the database backstop for direct Supabase access; Function authorization is the application boundary for privileged reads and writes.

## Current route model

Owner: overview, clients, portal preview, integrations, reports, settings.

Employee: overview, clients, integrations, reports.

Customer: portal only, scoped to the assigned client.

The navigation model is not a security boundary. `lib/access-control.ts`, Supabase RLS, and Function authorization must agree.

## Delivery conventions

Use typed data helpers in `lib/`, keep provider calls in Functions, keep loading/error/empty states explicit, and add migrations before relying on a new table or policy. See `docs/security-model.md` and `docs/backend-setup.md` for operational details.
