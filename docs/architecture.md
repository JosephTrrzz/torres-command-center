# Torres OS architecture

Updated 2026-08-25.

## Current runtime

- Next.js 14 App Router with React 18 and TypeScript.
- Static application export hosted on Cloudflare Pages.
- Cloudflare Pages Functions under `functions/api` for privileged server work.
- Supabase Auth and Postgres for identity and application data.
- Google OAuth and reporting adapters implemented server-side.

This remains the production architecture. Torres OS will evolve as a modular monolith: cohesive domain modules in one deployable application, with explicit boundaries that can be separated only when scale or isolation requires it.

## Layers

1. Presentation: route components, reusable UI components, form state, and accessible feedback.
2. Application: use cases, permission decisions, orchestration, and provider-independent contracts.
3. Domain: organizations, clients, CRM, jobs, goals, opportunities, reports, automations, and audit semantics.
4. Infrastructure: Supabase repositories, Cloudflare Functions, provider adapters, background jobs, and event outbox.

## Tenant model

An organization is the primary security boundary. Agency organizations can manage child client organizations through explicit memberships and relationships. Existing `clients` rows remain the customer master records and are linked one-to-one to client organizations during migration. The legacy `profiles.client_id` model remains active until all reads and Functions are organization-aware.

## Request flow

Browser requests use the Supabase publishable key plus the signed-in user's access token. Direct reads are constrained by RLS. Privileged writes and third-party calls go through a Cloudflare Function, which validates the token, loads the caller's profile and membership, checks the requested tenant, performs the action with the service role, and writes audit or outbox records.

## Integration framework

Each provider implements a common adapter lifecycle: authorize, verify, discover resources, save mapping, sync, normalize, report freshness, refresh credentials, and disconnect. Raw provider responses are retained only when required and are never used directly by UI components. Normalized data includes source, tenant, external identifier, observed time, synced time, and freshness status.

## Background work

Durable work is represented in an event outbox before execution. Workers claim pending events, record attempts, apply bounded retries, and move exhausted work to a dead-letter state. User-facing state distinguishes queued, running, delayed, failed, and complete.

## AI boundary

Torres AI receives an explicit organization and user context. Retrieval is tenant-scoped before content reaches a model. Responses identify evidence, freshness, and uncertainty. Any external write, message, publication, financial action, or destructive change requires a separate approval step and an audit record.

## Delivery topology

- Production admin: `https://admin.torrescotechnology.com`
- Static fallback: Cloudflare Pages project domain
- Public company site: separate Cloudflare Pages project
- Database and auth: Supabase project documented in the operator checklist

No browser bundle may contain the Supabase service role, Google client secret, provider access token, or AI provider secret.
