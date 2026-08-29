-- Torres OS Inbox organization: durable categories and reversible archiving.
-- Additive and idempotent. Apply after communications.sql.

begin;

alter table public.conversations add column if not exists category text not null default 'general';
alter table public.conversations add column if not exists archived_at timestamptz;
alter table public.conversations add column if not exists archived_by uuid references public.profiles(id) on delete set null;

alter table public.conversations drop constraint if exists conversations_category_check;
alter table public.conversations add constraint conversations_category_check
  check (category in ('general', 'sales', 'onboarding', 'project', 'support', 'billing'));

create index if not exists conversations_client_archive_category_idx
  on public.conversations (client_id, archived_at, category, last_message_at desc);

drop policy if exists "conversations_accessible_read" on public.conversations;
create policy "conversations_accessible_read" on public.conversations for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (client_visible and archived_at is null and client_id = public.current_client_id())
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
      or (
        conversation.client_visible
        and conversation.archived_at is null
        and conversation.client_id = public.current_client_id()
      )
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
          and conversation.archived_at is null
          and conversation.client_id = public.current_client_id()
      )
    )
  )
);

comment on column public.conversations.category is 'Staff-selected Inbox category used for durable filtering and workflow organization.';
comment on column public.conversations.archived_at is 'When set, removes the conversation from active staff queues and client portal visibility without deleting history.';
comment on column public.conversations.archived_by is 'Authenticated staff profile that last archived the conversation.';

commit;
