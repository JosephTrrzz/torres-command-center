-- Torres OS Phase 4: tenant-safe conversations, messages, and delivery records.
-- Additive and idempotent. Apply after access_control.sql and clients_schema.sql.

begin;

insert into public.permissions (key, name, description) values
  ('communications.read', 'Read communications', 'View authorized client conversations and messages.'),
  ('communications.manage', 'Manage communications', 'Create conversations, draft outbound messages, and manage communication status.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role, permission_key)
select role_name, permission_key
from (values
  ('owner', 'communications.read'), ('owner', 'communications.manage'),
  ('admin', 'communications.read'), ('admin', 'communications.manage'),
  ('operator', 'communications.read'), ('operator', 'communications.manage'),
  ('member', 'communications.read'), ('member', 'communications.manage'),
  ('viewer', 'communications.read'),
  ('client', 'communications.read'), ('client', 'communications.manage')
) as role_map(role_name, permission_key)
on conflict do nothing;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  subject text not null check (length(trim(subject)) between 1 and 180),
  channel text not null default 'internal' check (channel in ('internal', 'email', 'sms', 'voice')),
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  client_visible boolean not null default true,
  last_message_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_client_activity_idx on public.conversations (client_id, status, last_message_at desc);
create index if not exists conversations_assignee_idx on public.conversations (assigned_to, status, last_message_at desc);

create table if not exists public.message_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  participant_type text not null check (participant_type in ('profile', 'client_person', 'external', 'system')),
  profile_id uuid references public.profiles(id) on delete set null,
  client_person_id uuid references public.client_people(id) on delete set null,
  display_name text not null default '',
  address text not null default '',
  participant_role text not null default 'recipient' check (participant_role in ('sender', 'recipient', 'cc')),
  created_at timestamptz not null default now()
);

create index if not exists message_participants_conversation_idx on public.message_participants (conversation_id, created_at);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound', 'system')),
  channel text not null check (channel in ('internal', 'email', 'sms', 'voice')),
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'delivered', 'failed', 'received')),
  sender_name text not null default '',
  sender_address text not null default '',
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array'),
  subject text not null default '',
  body text not null check (length(trim(body)) between 1 and 8000),
  provider_message_id text,
  error_detail text not null default '',
  client_visible boolean not null default true,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists messages_client_status_idx on public.messages (client_id, status, created_at desc);

alter table public.conversations enable row level security;
alter table public.message_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_accessible_read" on public.conversations;
create policy "conversations_accessible_read" on public.conversations for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (client_visible and client_id = public.current_client_id())
  )
);

drop policy if exists "message_participants_accessible_read" on public.message_participants;
create policy "message_participants_accessible_read" on public.message_participants for select to authenticated
using (exists (
  select 1 from public.conversations conversation
  where conversation.id = conversation_id
    and public.can_access_organization(conversation.organization_id)
    and (
      not public.has_organization_role(conversation.organization_id, array['client'])
      or (conversation.client_visible and conversation.client_id = public.current_client_id())
    )
));

drop policy if exists "messages_accessible_read" on public.messages;
create policy "messages_accessible_read" on public.messages for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (
      client_visible
      and client_id = public.current_client_id()
      and exists (
        select 1 from public.conversations conversation
        where conversation.id = conversation_id
          and conversation.client_visible
          and conversation.client_id = public.current_client_id()
      )
    )
  )
);

-- All writes pass through the authenticated Pages Function so authorization,
-- validation, notifications, audit history, and delivery truth stay centralized.
revoke all on public.conversations, public.message_participants, public.messages from anon;
revoke all on public.conversations, public.message_participants, public.messages from authenticated;
grant select on public.conversations, public.message_participants, public.messages to authenticated;

comment on table public.conversations is 'Organization- and client-scoped inbox threads shared by agency staff and authorized client users.';
comment on table public.message_participants is 'Normalized communication participants without granting direct write access to the browser.';
comment on table public.messages is 'Immutable message records. Email remains draft until an approved delivery provider returns a real provider message ID.';

commit;
