# Torres OS repository guide

## Product contract

Torres OS is a multi-tenant operating system for local businesses. The existing Torres & Co. Command Center is the production foundation and must remain usable while the broader product is delivered incrementally.

## Architecture rules

- Preserve the Next.js 14 static export, Cloudflare Pages, Cloudflare Pages Functions, and Supabase stack unless a documented decision changes it.
- Keep privileged provider calls and service-role operations in `functions/`; never expose server secrets through `NEXT_PUBLIC_*` variables.
- Keep reusable domain and data logic in `lib/`; React pages should orchestrate UI rather than own authorization or provider logic.
- Treat navigation as presentation only. Authorization must agree across application guards, Function checks, and Supabase RLS.
- Every tenant-owned row must have an explicit organization or client scope. New migrations are additive, reversible where practical, and safe for existing production records.
- Never show fabricated metrics or a connected state without verified credentials and a successful provider response.
- Every user-facing data surface needs loading, empty, error, disconnected, permission-denied, and success states as applicable.

## Delivery workflow

1. Read `docs/STATUS.md`, `docs/EXECUTION_PLAN.md`, and `docs/DECISIONS.md` before starting a milestone.
2. Inspect the current implementation and preserve unrelated changes.
3. Add or update migrations before relying on new database fields.
4. Add tests for permission, tenant-boundary, and domain logic changes.
5. Run `npm test`, `npx tsc --noEmit`, `npx tsc -p functions/tsconfig.json --noEmit`, and `npm run build`.
6. Update status and decision documentation with verified facts only.

## Current compatibility boundary

The legacy access model uses `profiles.role` and `profiles.client_id`. The Torres OS organization and membership model is introduced additively and will run beside that model until all routes and Functions use organization-scoped authorization. Do not remove the legacy fields during the transition.
