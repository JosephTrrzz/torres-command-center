-- Torres OS Phase 7: private, tenant-scoped Torres AI records.
-- Additive and idempotent. Apply after torres_os_foundation.sql.

begin;

create table if not exists public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New conversation' check (length(trim(title)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_threads_owner_recent_idx
on public.ai_threads (owner_user_id, organization_id, status, coalesce(last_message_at, created_at) desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  kind text not null default 'answer' check (kind in ('answer', 'daily_briefing', 'weekly_summary')),
  content text not null check (length(trim(content)) between 1 and 12000),
  confidence text check (confidence is null or confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_thread_created_idx
on public.ai_messages (thread_id, created_at);

create table if not exists public.ai_citations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  source_type text not null check (source_type in ('client', 'crm_lead', 'project', 'service_job', 'report_snapshot', 'notification')),
  source_id text not null check (length(trim(source_id)) > 0),
  label text not null check (length(trim(label)) between 1 and 180),
  href text not null check (href ~ '^/[a-z0-9/_?=&%.-]*$' and href !~ '^//'),
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, source_type, source_id)
);

create index if not exists ai_citations_message_idx on public.ai_citations (message_id, created_at);

create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  thread_id uuid not null references public.ai_threads(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  action_type text not null check (length(trim(action_type)) between 1 and 80),
  action_summary text not null check (length(trim(action_summary)) between 1 and 500),
  action_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(action_payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'canceled')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ai_approvals_owner_status_idx
on public.ai_approvals (requested_by, organization_id, status, created_at desc);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  thread_id uuid references public.ai_threads(id) on delete set null,
  request_id text not null unique,
  model text not null default '',
  status text not null check (status in ('processing', 'succeeded', 'refused', 'failed', 'rate_limited')),
  evidence_count integer not null default 0 check (evidence_count between 0 and 100),
  input_characters integer not null default 0 check (input_characters between 0 and 20000),
  output_characters integer not null default 0 check (output_characters between 0 and 20000),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  failure_code text,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_recent_idx
on public.ai_usage_events (user_id, organization_id, created_at desc);

create or replace function public.claim_ai_request(
  target_organization_id uuid,
  target_user_id uuid,
  target_thread_id uuid,
  target_request_id text,
  target_evidence_count integer,
  target_input_characters integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
  daily_count integer;
  result text := 'accepted';
begin
  if length(target_request_id) < 16
    or target_evidence_count not between 0 and 40
    or target_input_characters not between 1 and 2000
    or not exists (
      select 1 from public.organization_memberships
      where organization_id = target_organization_id
        and user_id = target_user_id
        and status = 'active'
    )
    or not exists (
      select 1 from public.ai_threads
      where id = target_thread_id
        and organization_id = target_organization_id
        and owner_user_id = target_user_id
        and status = 'active'
    ) then
    raise exception 'Invalid or unauthorized AI usage claim';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_user_id::text, 0));
  select count(*) into recent_count from public.ai_usage_events
  where organization_id = target_organization_id and user_id = target_user_id
    and created_at >= now() - interval '10 minutes';
  select count(*) into daily_count from public.ai_usage_events
  where organization_id = target_organization_id and user_id = target_user_id
    and created_at >= now() - interval '24 hours';

  if recent_count >= 20 then result := 'minute_limit';
  elsif daily_count >= 100 then result := 'daily_limit';
  end if;

  insert into public.ai_usage_events (
    organization_id, user_id, thread_id, request_id, status, evidence_count, input_characters, failure_code
  ) values (
    target_organization_id, target_user_id, target_thread_id, target_request_id,
    case when result = 'accepted' then 'processing' else 'rate_limited' end,
    target_evidence_count, target_input_characters,
    case when result = 'accepted' then null else result end
  );
  return result;
end;
$$;

revoke all on function public.claim_ai_request(uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_request(uuid, uuid, uuid, text, integer, integer) to service_role;

create or replace function public.persist_ai_answer(
  target_organization_id uuid,
  target_user_id uuid,
  target_thread_id uuid,
  target_kind text,
  target_prompt text,
  target_answer text,
  target_confidence text,
  target_citations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  assistant_message_id uuid;
  citation jsonb;
begin
  if target_kind not in ('answer', 'daily_briefing', 'weekly_summary')
    or target_confidence not in ('low', 'medium', 'high')
    or length(trim(target_prompt)) not between 1 and 2000
    or length(trim(target_answer)) not between 1 and 12000
    or target_citations is null
    or jsonb_typeof(target_citations) <> 'array'
    or jsonb_array_length(target_citations) > 8
    or not exists (
      select 1 from public.ai_threads
      where id = target_thread_id
        and organization_id = target_organization_id
        and owner_user_id = target_user_id
        and status = 'active'
    ) then
    raise exception 'Invalid or unauthorized AI answer';
  end if;

  insert into public.ai_messages (organization_id, thread_id, author_user_id, role, kind, content)
  values (target_organization_id, target_thread_id, target_user_id, 'user', target_kind, trim(target_prompt));
  insert into public.ai_messages (organization_id, thread_id, role, kind, content, confidence)
  values (target_organization_id, target_thread_id, 'assistant', target_kind, trim(target_answer), target_confidence)
  returning id into assistant_message_id;

  for citation in select value from jsonb_array_elements(target_citations)
  loop
    insert into public.ai_citations (
      organization_id, thread_id, message_id, source_type, source_id, label, href, observed_at
    ) values (
      target_organization_id,
      target_thread_id,
      assistant_message_id,
      citation->>'source_type',
      citation->>'source_id',
      citation->>'label',
      citation->>'href',
      nullif(citation->>'observed_at', '')::timestamptz
    );
  end loop;

  update public.ai_threads set last_message_at = now(), updated_at = now()
  where id = target_thread_id and organization_id = target_organization_id and owner_user_id = target_user_id;
  return assistant_message_id;
end;
$$;

revoke all on function public.persist_ai_answer(uuid, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_ai_answer(uuid, uuid, uuid, text, text, text, text, jsonb) to service_role;

create or replace function public.enforce_ai_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  thread_organization uuid;
  thread_owner uuid;
begin
  select organization_id, owner_user_id into thread_organization, thread_owner
  from public.ai_threads where id = new.thread_id;
  if thread_organization is null or thread_organization <> new.organization_id then
    raise exception 'AI record and thread organization scope do not match';
  end if;
  if tg_table_name = 'ai_approvals' and thread_owner <> new.requested_by then
    raise exception 'AI approval requester must own the thread';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_ai_scope() from public, anon, authenticated;

drop trigger if exists ai_messages_scope_guard on public.ai_messages;
create trigger ai_messages_scope_guard before insert or update on public.ai_messages
for each row execute function public.enforce_ai_scope();
drop trigger if exists ai_citations_scope_guard on public.ai_citations;
create trigger ai_citations_scope_guard before insert or update on public.ai_citations
for each row execute function public.enforce_ai_scope();
drop trigger if exists ai_approvals_scope_guard on public.ai_approvals;
create trigger ai_approvals_scope_guard before insert or update on public.ai_approvals
for each row execute function public.enforce_ai_scope();

alter table public.ai_threads enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_citations enable row level security;
alter table public.ai_approvals enable row level security;
alter table public.ai_usage_events enable row level security;

drop policy if exists "ai_threads_owner_read" on public.ai_threads;
create policy "ai_threads_owner_read" on public.ai_threads for select to authenticated
using (owner_user_id = auth.uid() and public.can_access_organization(organization_id));

drop policy if exists "ai_messages_owner_read" on public.ai_messages;
create policy "ai_messages_owner_read" on public.ai_messages for select to authenticated
using (public.can_access_organization(organization_id) and exists (
  select 1 from public.ai_threads thread_row
  where thread_row.id = thread_id and thread_row.owner_user_id = auth.uid()
));

drop policy if exists "ai_citations_owner_read" on public.ai_citations;
create policy "ai_citations_owner_read" on public.ai_citations for select to authenticated
using (public.can_access_organization(organization_id) and exists (
  select 1 from public.ai_threads thread_row
  where thread_row.id = thread_id and thread_row.owner_user_id = auth.uid()
));

drop policy if exists "ai_approvals_requester_read" on public.ai_approvals;
create policy "ai_approvals_requester_read" on public.ai_approvals for select to authenticated
using (requested_by = auth.uid() and public.can_access_organization(organization_id));

drop policy if exists "ai_usage_self_read" on public.ai_usage_events;
create policy "ai_usage_self_read" on public.ai_usage_events for select to authenticated
using (user_id = auth.uid() and public.can_access_organization(organization_id));

revoke all on public.ai_threads, public.ai_messages, public.ai_citations, public.ai_approvals, public.ai_usage_events from anon, authenticated;
grant select on public.ai_threads, public.ai_messages, public.ai_citations, public.ai_approvals, public.ai_usage_events to authenticated;

comment on table public.ai_threads is 'Private user-owned Torres AI conversation index inside one authorized organization.';
comment on table public.ai_messages is 'Tenant-scoped AI conversation content written only by the protected server boundary.';
comment on table public.ai_citations is 'Server-verified application evidence attached to an AI response.';
comment on table public.ai_approvals is 'Separate human approval records for future consequential AI actions; Phase 7 starts read-only.';
comment on table public.ai_usage_events is 'Privacy-minimized AI request telemetry. Prompts and responses are intentionally excluded.';
comment on function public.claim_ai_request(uuid, uuid, uuid, text, integer, integer) is 'Atomically verifies AI scope, applies per-user rate limits, and records privacy-minimized request metadata.';
comment on function public.persist_ai_answer(uuid, uuid, uuid, text, text, text, text, jsonb) is 'Atomically stores one user prompt, one verified assistant answer, its citations, and the thread timestamp.';

commit;
