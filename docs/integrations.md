# Torres OS integrations

Updated 2026-08-25.

## Connection lifecycle

Every integration follows the same visible states:

`not configured → authorization required → authorized → resource mapping required → syncing → current`

Failure states are explicit: permission denied, provider approval pending, token expired, rate limited, provider unavailable, mapping invalid, or sync failed. A card may display `Connected` only after authorization is verified; data surfaces display freshness separately.

## Adapter contract

Each adapter implements authorization and callback validation, credential verification and refresh, resource discovery and tenant-safe mapping, incremental and full synchronization, normalized data, freshness reporting, disconnect, and auditable redacted errors.

## Current production connections

- Supabase: identity, tenant data, portal activation, notifications, and connection metadata.
- Google OAuth: working for GA4 and Search Console resource discovery and reporting.
- Google Analytics Data API: live 28-day metrics available for mapped properties.
- Google Search Console: live clicks and impressions available for mapped sites.
- Google Business Profile: authorization exists, but location discovery is externally blocked while Google API quota/approval remains pending.
- Cloudflare: Pages hosting, custom admin domain, Functions, production variables, and automatic GitHub deployment.

## Planned adapters

PageSpeed Insights, Cloudflare telemetry, Google Business Profile reviews, Square, email/newsletter delivery, SMS/voice, AI receptionist, file storage, and document signing are planned. They are not production-complete until authorization, mapping, sync, error handling, disconnect, and tests exist.

## Normalization and sync

Provider data is transformed into internal entities or metric observations. UI code reads normalized contracts and never arbitrary provider response shapes. Connections track last success, last attempt, cursor, next run, error category, and credential expiry. Syncs are idempotent and use external IDs. Rate limits back off without presenting stale data as current.

## Setup responsibilities

`BACKEND_CONNECTION_CHECKLIST.md` records owner, credentials, callbacks, provider approval, webhook signatures, RLS/migrations, mapping, sync validation, and disconnect tests for every provider.
