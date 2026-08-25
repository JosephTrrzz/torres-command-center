-- Torres OS additive organization, authorization, audit, and outbox foundation.
-- Safe migration strategy: preserve the working profiles.role/client_id model while
-- introducing normalized organizations and memberships for a controlled cutover.

begin;

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind text not null check (kind in ('agency', 'client')),
  parent_organization_id uuid references public.organizations(id) on delete restrict,
  legacy_client_id uuid unique references public.clients(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'invited', 'paused', 'archived')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'agency' or parent_organization_id is not null)
);

create table if not exists public.permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]+$'),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role text not null check (role in ('owner', 'admin', 'operator', 'member', 'viewer', 'client')),
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'member', 'viewer', 'client')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role text not null check (role in ('admin', 'operator', 'member', 'viewer', 'client')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  token_hash text unique,
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_invitations_pending_email_idx
on public.organization_invitations (organization_id, lower(email))
where status = 'pending';

create table if not exists public.user_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  preference_key text not null check (length(trim(preference_key)) > 0),
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id, preference_key)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id text,
  request_id text,
  source text not null default 'application',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists audit_events_organization_created_idx
on public.audit_events (organization_id, created_at desc);

create table if not exists public.event_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_type text not null check (length(trim(event_type)) > 0),
  aggregate_type text not null check (length(trim(aggregate_type)) > 0),
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_outbox_pending_idx
on public.event_outbox (status, available_at, created_at)
where status in ('pending', 'failed');

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'organization_id'
  ) then
    alter table public.clients add column organization_id uuid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_organization_id_fkey' and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete set null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'default_organization_id'
  ) then
    alter table public.profiles add column default_organization_id uuid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_default_organization_id_fkey' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_default_organization_id_fkey
      foreign key (default_organization_id) references public.organizations(id) on delete set null;
  end if;
end
$$;

insert into public.permissions (key, name, description) values
  ('organization.manage', 'Manage organization', 'Update organization settings and membership.'),
  ('clients.read', 'Read clients', 'View client organizations and profiles.'),
  ('clients.manage', 'Manage clients', 'Create and update client organizations.'),
  ('integrations.read', 'Read integrations', 'View provider connection state and mappings.'),
  ('integrations.manage', 'Manage integrations', 'Connect, map, refresh, and disconnect providers.'),
  ('reports.read', 'Read reports', 'View organization reports and metric provenance.'),
  ('reports.export', 'Export reports', 'Generate or download organization reports.'),
  ('audit.read', 'Read audit history', 'View organization audit events.'),
  ('automation.manage', 'Manage automations', 'Create and approve organization automations.'),
  ('ai.use', 'Use Torres AI', 'Ask tenant-scoped questions and create drafts.')
on conflict (key) do update
set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role, permission_key)
select role_name, permission_key
from (values
  ('owner', 'organization.manage'), ('owner', 'clients.read'), ('owner', 'clients.manage'),
  ('owner', 'integrations.read'), ('owner', 'integrations.manage'), ('owner', 'reports.read'),
  ('owner', 'reports.export'), ('owner', 'audit.read'), ('owner', 'automation.manage'), ('owner', 'ai.use'),
  ('admin', 'organization.manage'), ('admin', 'clients.read'), ('admin', 'clients.manage'),
  ('admin', 'integrations.read'), ('admin', 'integrations.manage'), ('admin', 'reports.read'),
  ('admin', 'reports.export'), ('admin', 'audit.read'), ('admin', 'automation.manage'), ('admin', 'ai.use'),
  ('operator', 'clients.read'), ('operator', 'clients.manage'), ('operator', 'integrations.read'),
  ('operator', 'integrations.manage'), ('operator', 'reports.read'), ('operator', 'reports.export'),
  ('operator', 'ai.use'),
  ('member', 'clients.read'), ('member', 'integrations.read'), ('member', 'reports.read'),
  ('member', 'reports.export'), ('member', 'ai.use'),
  ('viewer', 'clients.read'), ('viewer', 'integrations.read'), ('viewer', 'reports.read'),
  ('client', 'integrations.read'), ('client', 'reports.read'), ('client', 'reports.export'), ('client', 'ai.use')
) as role_map(role_name, permission_key)
on conflict do nothing;

-- Create the agency organization once and link every existing client through a
-- dedicated child organization. UUID suffixes make generated slugs deterministic.
insert into public.organizations (name, slug, kind, status, created_by)
select
  'Torres & Co. Technology',
  'torres-co-technology',
  'agency',
  'active',
  (select id from public.profiles where role = 'owner' and active = true order by created_at limit 1)
where not exists (select 1 from public.organizations where slug = 'torres-co-technology');

insert into public.organizations (name, slug, kind, parent_organization_id, legacy_client_id, status, created_by)
select
  c.name,
  'client-' || replace(left(c.id::text, 8), '-', ''),
  'client',
  agency.id,
  c.id,
  'active',
  (select id from public.profiles where role = 'owner' and active = true order by created_at limit 1)
from public.clients c
cross join lateral (
  select id from public.organizations where slug = 'torres-co-technology' limit 1
) agency
where not exists (
  select 1 from public.organizations organization_row where organization_row.legacy_client_id = c.id
);

update public.clients client_row
set organization_id = organization_row.id
from public.organizations organization_row
where organization_row.legacy_client_id = client_row.id
  and client_row.organization_id is distinct from organization_row.id;

insert into public.organization_memberships (organization_id, user_id, role, status, joined_at)
select
  agency.id,
  profile_row.id,
  case when profile_row.role = 'owner' then 'owner' else 'operator' end,
  'active',
  now()
from public.profiles profile_row
cross join lateral (
  select id from public.organizations where slug = 'torres-co-technology' limit 1
) agency
where profile_row.active = true and profile_row.role in ('owner', 'employee')
on conflict (organization_id, user_id) do update
set role = excluded.role, status = 'active', updated_at = now();

insert into public.organization_memberships (organization_id, user_id, role, status, joined_at)
select organization_row.id, profile_row.id, 'client', 'active', now()
from public.profiles profile_row
join public.organizations organization_row on organization_row.legacy_client_id = profile_row.client_id
where profile_row.active = true and profile_row.role = 'customer'
on conflict (organization_id, user_id) do update
set role = 'client', status = 'active', updated_at = now();

update public.profiles profile_row
set default_organization_id = coalesce(
  (select organization_id from public.organization_memberships membership_row
   where membership_row.user_id = profile_row.id and membership_row.status = 'active'
   order by case membership_row.role when 'owner' then 0 when 'admin' then 1 when 'operator' then 2 else 3 end
   limit 1),
  profile_row.default_organization_id
)
where profile_row.default_organization_id is null;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships membership_row
    where membership_row.organization_id = target_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.status = 'active'
  )
$$;

create or replace function public.has_organization_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships membership_row
    where membership_row.organization_id = target_organization_id
      and membership_row.user_id = auth.uid()
      and membership_row.status = 'active'
      and membership_row.role = any(allowed_roles)
  )
$$;

create or replace function public.can_access_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_organization_member(target_organization_id)
    or exists (
      select 1
      from public.organizations child_organization
      join public.organization_memberships parent_membership
        on parent_membership.organization_id = child_organization.parent_organization_id
      where child_organization.id = target_organization_id
        and parent_membership.user_id = auth.uid()
        and parent_membership.status = 'active'
        and parent_membership.role in ('owner', 'admin', 'operator', 'member', 'viewer')
    )
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_organization_role(target_organization_id, array['owner', 'admin'])
    or exists (
      select 1
      from public.organizations child_organization
      join public.organization_memberships parent_membership
        on parent_membership.organization_id = child_organization.parent_organization_id
      where child_organization.id = target_organization_id
        and parent_membership.user_id = auth.uid()
        and parent_membership.status = 'active'
        and parent_membership.role in ('owner', 'admin', 'operator')
    )
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, text[]) from public;
revoke all on function public.can_access_organization(uuid) from public;
revoke all on function public.can_manage_organization(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, text[]) to authenticated;
grant execute on function public.can_access_organization(uuid) to authenticated;
grant execute on function public.can_manage_organization(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.user_preferences enable row level security;
alter table public.audit_events enable row level security;
alter table public.event_outbox enable row level security;

drop policy if exists "organizations_accessible_read" on public.organizations;
drop policy if exists "organizations_managers_update" on public.organizations;
create policy "organizations_accessible_read" on public.organizations for select to authenticated
using (public.can_access_organization(id));
create policy "organizations_managers_update" on public.organizations for update to authenticated
using (public.can_manage_organization(id)) with check (public.can_manage_organization(id));

drop policy if exists "permission_catalog_read" on public.permissions;
drop policy if exists "role_permission_catalog_read" on public.role_permissions;
create policy "permission_catalog_read" on public.permissions for select to authenticated using (true);
create policy "role_permission_catalog_read" on public.role_permissions for select to authenticated using (true);

drop policy if exists "memberships_accessible_read" on public.organization_memberships;
create policy "memberships_accessible_read" on public.organization_memberships for select to authenticated
using (user_id = auth.uid() or public.can_manage_organization(organization_id));

drop policy if exists "invitations_managers_read" on public.organization_invitations;
create policy "invitations_managers_read" on public.organization_invitations for select to authenticated
using (public.can_manage_organization(organization_id));

drop policy if exists "preferences_self_read" on public.user_preferences;
drop policy if exists "preferences_self_insert" on public.user_preferences;
drop policy if exists "preferences_self_update" on public.user_preferences;
drop policy if exists "preferences_self_delete" on public.user_preferences;
create policy "preferences_self_read" on public.user_preferences for select to authenticated
using (user_id = auth.uid() and public.can_access_organization(organization_id));
create policy "preferences_self_insert" on public.user_preferences for insert to authenticated
with check (user_id = auth.uid() and public.can_access_organization(organization_id));
create policy "preferences_self_update" on public.user_preferences for update to authenticated
using (user_id = auth.uid() and public.can_access_organization(organization_id))
with check (user_id = auth.uid() and public.can_access_organization(organization_id));
create policy "preferences_self_delete" on public.user_preferences for delete to authenticated
using (user_id = auth.uid() and public.can_access_organization(organization_id));

drop policy if exists "audit_accessible_read" on public.audit_events;
create policy "audit_accessible_read" on public.audit_events for select to authenticated
using (public.can_access_organization(organization_id));

grant select, update on public.organizations to authenticated;
grant select on public.permissions, public.role_permissions, public.organization_memberships,
  public.organization_invitations, public.audit_events to authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;

comment on table public.organizations is 'Agency and client tenant boundaries for Torres OS.';
comment on table public.organization_memberships is 'User-to-organization roles; authoritative after the controlled access cutover.';
comment on table public.organization_invitations is 'Invitation lifecycle metadata. Raw invitation tokens must never be stored.';
comment on table public.permissions is 'Stable permission catalog used by organization roles.';
comment on table public.role_permissions is 'Default permission matrix for organization roles.';
comment on table public.user_preferences is 'Per-user, per-organization preferences synchronized across devices.';
comment on table public.audit_events is 'Immutable organization-scoped security and business history.';
comment on table public.event_outbox is 'Durable provider, notification, automation, and analytics work queue.';

commit;
