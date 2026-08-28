-- Torres OS Phase 4: private file attachments for outbound Inbox email.
-- Additive and idempotent. Apply after communications.sql.

begin;

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  file_name text not null check (length(trim(file_name)) between 1 and 180),
  content_type text not null check (length(trim(content_type)) between 1 and 160),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  storage_bucket text not null default 'communication-attachments',
  storage_path text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_message_created_idx
  on public.message_attachments (message_id, created_at);
create index if not exists message_attachments_client_created_idx
  on public.message_attachments (client_id, created_at desc);

alter table public.message_attachments enable row level security;

drop policy if exists "message_attachments_accessible_read" on public.message_attachments;
create policy "message_attachments_accessible_read" on public.message_attachments for select to authenticated
using (
  public.can_access_organization(message_attachments.organization_id)
  and exists (
    select 1
    from public.messages message
    join public.conversations conversation on conversation.id = message.conversation_id
    where message.id = message_attachments.message_id
      and message.client_id = message_attachments.client_id
      and conversation.client_id = message_attachments.client_id
      and (
        not public.has_organization_role(message_attachments.organization_id, array['client'])
        or (
          message.client_visible
          and conversation.client_visible
          and message_attachments.client_id = public.current_client_id()
        )
      )
  )
);

-- Browser clients receive downloads through the authenticated Pages Function.
-- Storage and table writes stay service-role only so attachment validation,
-- tenant scoping, audit behavior, and draft immutability cannot be bypassed.
revoke all on public.message_attachments from anon;
revoke all on public.message_attachments from authenticated;
grant select on public.message_attachments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'communication-attachments',
  'communication-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.message_attachments is 'Private, tenant-scoped files attached to Inbox email messages. Objects are served only through an authenticated Pages Function.';
comment on column public.message_attachments.storage_path is 'Private Supabase Storage object path. Never expose this path as a public URL.';

commit;
