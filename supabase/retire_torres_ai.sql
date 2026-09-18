-- Retire the Torres AI product surface without deleting private historical records.
-- Apply after torres_ai.sql on databases where that retired feature was installed.

begin;

delete from public.role_permissions
where permission_key = 'ai.use';

delete from public.permissions
where key = 'ai.use';

revoke all on public.ai_threads, public.ai_messages, public.ai_citations,
  public.ai_approvals, public.ai_usage_events from anon, authenticated, service_role;

drop policy if exists "ai_threads_owner_read" on public.ai_threads;
drop policy if exists "ai_messages_owner_read" on public.ai_messages;
drop policy if exists "ai_citations_owner_read" on public.ai_citations;
drop policy if exists "ai_approvals_requester_read" on public.ai_approvals;
drop policy if exists "ai_usage_self_read" on public.ai_usage_events;

revoke all on function public.claim_ai_request(uuid, uuid, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.persist_ai_answer(uuid, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

comment on table public.ai_threads is 'Retired Torres AI history retained for controlled operator disposition; unavailable to the application.';
comment on table public.ai_messages is 'Retired Torres AI history retained for controlled operator disposition; unavailable to the application.';
comment on table public.ai_citations is 'Retired Torres AI citation history retained for controlled operator disposition; unavailable to the application.';
comment on table public.ai_approvals is 'Retired Torres AI approval history retained for controlled operator disposition; unavailable to the application.';
comment on table public.ai_usage_events is 'Retired Torres AI telemetry retained for controlled operator disposition; unavailable to the application.';

commit;
