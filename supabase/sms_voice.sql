-- Torres OS Phase 4C: consent-safe SMS and voice communication records.
-- Additive and idempotent. Apply after communications.sql.

begin;

create table if not exists public.communication_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('twilio')),
  status text not null default 'setup_required' check (status in ('setup_required', 'connected', 'disabled', 'error')),
  sender_address text not null default '',
  messaging_service_sid text not null default '',
  voice_number text not null default '',
  last_error text not null default '',
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists public.communication_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_person_id uuid references public.client_people(id) on delete set null,
  channel text not null check (channel in ('sms', 'voice')),
  address text not null check (length(trim(address)) between 8 and 24),
  status text not null default 'pending' check (status in ('pending', 'granted', 'revoked')),
  source text not null default 'admin_recorded' check (source in ('admin_recorded', 'client_confirmed', 'provider_keyword', 'imported')),
  evidence text not null default '',
  granted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, channel, address)
);

create index if not exists communication_consents_client_idx
  on public.communication_consents (client_id, channel, status, updated_at desc);

create table if not exists public.communication_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  channel text not null check (channel in ('sms', 'voice')),
  address text not null check (length(trim(address)) between 8 and 24),
  reason text not null default 'recipient_opt_out',
  source text not null default 'provider_keyword',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, address)
);

create index if not exists communication_suppressions_active_idx
  on public.communication_suppressions (organization_id, channel, address) where active;

create table if not exists public.sms_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  provider text not null default 'twilio',
  provider_message_id text not null default '',
  direction text not null check (direction in ('inbound', 'outbound', 'system')),
  event_type text not null default 'status',
  status text not null default 'queued',
  from_address text not null default '',
  to_address text not null default '',
  error_detail text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists sms_events_provider_event_idx
  on public.sms_events (provider, provider_message_id, event_type, occurred_at)
  where provider_message_id <> '';
create index if not exists sms_events_client_activity_idx
  on public.sms_events (client_id, occurred_at desc);

create table if not exists public.call_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null default 'twilio',
  provider_call_id text not null default '',
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null default 'queued',
  from_address text not null default '',
  to_address text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  voicemail_url text not null default '',
  transcript text not null default '',
  client_visible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists call_records_provider_call_idx
  on public.call_records (provider, provider_call_id) where provider_call_id <> '';
create index if not exists call_records_client_activity_idx
  on public.call_records (client_id, created_at desc);

alter table public.communication_provider_connections enable row level security;
alter table public.communication_consents enable row level security;
alter table public.communication_suppressions enable row level security;
alter table public.sms_events enable row level security;
alter table public.call_records enable row level security;

drop policy if exists "communication_provider_connections_accessible_read" on public.communication_provider_connections;
create policy "communication_provider_connections_accessible_read" on public.communication_provider_connections for select to authenticated
using (public.can_access_organization(organization_id) and not public.has_organization_role(organization_id, array['client']));

drop policy if exists "communication_consents_accessible_read" on public.communication_consents;
create policy "communication_consents_accessible_read" on public.communication_consents for select to authenticated
using (public.can_access_organization(organization_id) and (not public.has_organization_role(organization_id, array['client']) or client_id = public.current_client_id()));

drop policy if exists "communication_suppressions_accessible_read" on public.communication_suppressions;
create policy "communication_suppressions_accessible_read" on public.communication_suppressions for select to authenticated
using (public.can_access_organization(organization_id) and not public.has_organization_role(organization_id, array['client']));

drop policy if exists "sms_events_accessible_read" on public.sms_events;
create policy "sms_events_accessible_read" on public.sms_events for select to authenticated
using (public.can_access_organization(organization_id) and (not public.has_organization_role(organization_id, array['client']) or client_id = public.current_client_id()));

drop policy if exists "call_records_accessible_read" on public.call_records;
create policy "call_records_accessible_read" on public.call_records for select to authenticated
using (public.can_access_organization(organization_id) and (not public.has_organization_role(organization_id, array['client']) or (client_id = public.current_client_id() and client_visible)));

revoke all on public.communication_provider_connections, public.communication_consents, public.communication_suppressions, public.sms_events, public.call_records from anon;
revoke all on public.communication_provider_connections, public.communication_consents, public.communication_suppressions, public.sms_events, public.call_records from authenticated;
grant select on public.communication_provider_connections, public.communication_consents, public.communication_suppressions, public.sms_events, public.call_records to authenticated;

comment on table public.communication_provider_connections is 'Non-secret provider readiness metadata. Provider credentials remain encrypted environment secrets.';
comment on table public.communication_consents is 'Auditable per-client SMS and voice consent; outbound contact is blocked unless consent is granted.';
comment on table public.communication_suppressions is 'Opt-out and do-not-contact records enforced before provider submission.';
comment on table public.sms_events is 'Provider lifecycle and inbound/outbound SMS events for delivery truth and audit history.';
comment on table public.call_records is 'Provider call and voicemail metadata; recordings and transcripts are not client-visible by default.';

commit;
