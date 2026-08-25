# Torres AI system

Updated 2026-08-25.

## Purpose

Torres AI turns verified workspace data into explanations, briefings, drafts, and recommended actions. It is not a source of truth and cannot silently perform consequential actions.

## Initial use cases

- Explain current performance using connected analytics and business records.
- Produce a daily priority briefing and a weekly operating summary.
- Answer tenant-scoped questions with citations to records and provider observations.
- Draft follow-ups, estimate notes, review responses, campaigns, and task plans.
- Surface opportunities whose evidence and scoring are visible to the user.

## Request pipeline

1. Authenticate the user and resolve the active organization.
2. Authorize the requested AI capability.
3. Build a tenant-scoped retrieval query.
4. Retrieve only permitted records and include source timestamps.
5. Generate a structured response with citations, assumptions, and confidence.
6. Persist the thread, response metadata, token/cost usage, and audit event.
7. If the response proposes an action, create a separate approval request.

## Evidence contract

Every factual claim derived from business data includes a citation containing entity type, record or metric identifier, source provider, and freshness timestamp. When evidence is missing or stale, the response says so. The model must not fill gaps with invented metrics, customers, jobs, or outcomes.

## Action safety

Torres AI may autonomously read, summarize, categorize, and draft. It may not send messages, publish content, modify access, spend or transfer money, accept estimates, delete business data, or change provider configuration without explicit approval. Approval records include the proposed payload, approving user, time, and final execution result.

## Provider abstraction

The application uses a provider-neutral AI interface for chat, structured generation, embeddings, and moderation. Model selection, timeout, retries, cost ceilings, and fallbacks are configuration, not page code. Keys remain server-only.

## Privacy and retention

Sensitive fields are minimized before model calls. Secrets and authentication material are always excluded. AI logs support configurable retention and deletion. Tenant data is never used to answer another tenant's request.

## Evaluation

Automated evaluation covers tenant isolation, citation validity, refusal of unsupported claims, approval gating, structured-output validation, and cost limits. Human review covers clarity, usefulness, and whether recommended actions are supported by evidence.
