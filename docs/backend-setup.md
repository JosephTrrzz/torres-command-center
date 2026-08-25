# Backend setup

## Required services

1. Create/apply the SQL files in `supabase/` in dependency order: access control and base tables first, then client people/customer accounts, Google connections/properties, and `notifications.sql`.
2. Configure the public Supabase URL and publishable/anon key for the frontend.
3. Configure the Supabase URL, service-role key, Google OAuth client ID/secret, and public app URL as Cloudflare Pages production secrets.
4. Confirm the Google OAuth redirect URI ends with `/api/google/callback` for both the production domain and approved preview fallback.

## Function contracts

- `GET /api/google/start?client=<uuid>` returns an authorization URL only to an authenticated staff user.
- `GET /api/google/status?client=<uuid>` returns connection status only to an authenticated staff user.
- `GET|POST /api/google/properties` requires an authenticated staff user.
- `GET /api/reports?client=<uuid>` requires a bearer token and enforces customer client scope server-side.

Frontend calls must forward the current Supabase access token in `Authorization: Bearer ...`. A missing or expired token should produce a visible sign-in/error state, not a fake connected state.

## Notification contract

- Apply `supabase/notifications.sql` before deploying code that writes notification events.
- Authenticated users may only select and mark their own rows read; browser clients cannot create or delete notifications.
- Server Functions use the service-role key to create truthful workflow events. Notification writes are best-effort and never block the primary workflow.
- Client invitation and activation-link workflows notify the initiating staff member and, when a user ID exists, the invited customer.

## Local verification

```bash
npm install
npm test
npx tsc --noEmit
npx tsc --noEmit -p functions/tsconfig.json
npm run build
```
