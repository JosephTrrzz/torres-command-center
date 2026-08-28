-- Torres OS website receptionist: public chat sessions backed by the shared Inbox.
-- Additive and idempotent. Apply after communications.sql and formspree_crm.sql.

begin;

alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('internal', 'email', 'sms', 'voice', 'webchat'));

alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages
  add constraint messages_channel_check
  check (channel in ('internal', 'email', 'sms', 'voice', 'webchat'));

create table if not exists public.receptionist_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null unique references public.clients(id) on delete cascade,
  active boolean not null default true,
  site_origin text not null,
  assistant_name text not null default 'Torres & Co. automated assistant',
  welcome_message text not null default 'Welcome to Torres & Co. Technology. I can help you find the right service or connect you with our team.',
  fallback_message text not null default 'I do not want to guess. I can collect your details and ask a Torres & Co. team member to follow up.',
  privacy_message text not null default 'Do not share passwords, payment details, or other sensitive information in chat.',
  allowed_topics text[] not null default array['services','service area','process','consultation','contact']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(site_origin)) between 8 and 300),
  check (length(trim(assistant_name)) between 1 and 120)
);

create table if not exists public.receptionist_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  config_id uuid references public.receptionist_configs(id) on delete cascade,
  title text not null,
  content text not null,
  keywords text[] not null default '{}'::text[],
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(title)) between 1 and 160),
  check (length(trim(content)) between 1 and 4000)
);

create index if not exists receptionist_knowledge_client_idx
  on public.receptionist_knowledge_entries (client_id, active, sort_order);

create table if not exists public.receptionist_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  config_id uuid references public.receptionist_configs(id) on delete set null,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  token_hash text not null unique,
  state text not null default 'anonymous' check (state in ('anonymous', 'qualified', 'handoff', 'staff_owned', 'closed')),
  ai_enabled boolean not null default true,
  visitor_name text not null default '',
  visitor_email text not null default '',
  visitor_phone text not null default '',
  visitor_company text not null default '',
  requested_service text not null default '',
  consent_to_contact boolean not null default false,
  origin text not null,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(token_hash) = 64)
);

create index if not exists receptionist_sessions_client_activity_idx
  on public.receptionist_sessions (client_id, state, last_seen_at desc);

create table if not exists public.receptionist_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  session_id uuid not null references public.receptionist_sessions(id) on delete cascade,
  action_type text not null check (action_type in ('session_started', 'faq_answered', 'lead_created', 'handoff_requested', 'staff_takeover', 'session_closed', 'rate_limited')),
  status text not null default 'completed' check (status in ('requested', 'completed', 'failed')),
  idempotency_key text unique,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists receptionist_actions_session_idx
  on public.receptionist_actions (session_id, created_at desc);

create table if not exists public.receptionist_rate_limits (
  bucket_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count between 1 and 10000),
  updated_at timestamptz not null default now(),
  primary key (bucket_hash, window_start)
);

alter table public.receptionist_configs enable row level security;
alter table public.receptionist_knowledge_entries enable row level security;
alter table public.receptionist_sessions enable row level security;
alter table public.receptionist_actions enable row level security;
alter table public.receptionist_rate_limits enable row level security;

drop policy if exists receptionist_configs_org_read on public.receptionist_configs;
create policy receptionist_configs_org_read on public.receptionist_configs for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists receptionist_knowledge_org_read on public.receptionist_knowledge_entries;
create policy receptionist_knowledge_org_read on public.receptionist_knowledge_entries for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists receptionist_sessions_org_read on public.receptionist_sessions;
create policy receptionist_sessions_org_read on public.receptionist_sessions for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists receptionist_actions_org_read on public.receptionist_actions;
create policy receptionist_actions_org_read on public.receptionist_actions for select to authenticated
using (public.can_access_organization(organization_id));

revoke all on public.receptionist_configs, public.receptionist_knowledge_entries,
  public.receptionist_sessions, public.receptionist_actions, public.receptionist_rate_limits from anon;
revoke all on public.receptionist_configs, public.receptionist_knowledge_entries,
  public.receptionist_sessions, public.receptionist_actions, public.receptionist_rate_limits from authenticated;
grant select on public.receptionist_configs, public.receptionist_knowledge_entries,
  public.receptionist_sessions, public.receptionist_actions to authenticated;

comment on table public.receptionist_sessions is 'Opaque-token website chat sessions linked to canonical shared Inbox conversations.';
comment on table public.receptionist_actions is 'Auditable receptionist decisions and explicit lead or human-handoff actions.';
comment on column public.receptionist_sessions.ai_enabled is 'False after human handoff or staff takeover; automated replies must stop immediately.';

commit;
