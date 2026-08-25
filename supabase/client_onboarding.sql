-- Torres OS Phase 2: resumable client onboarding and normalized business profile.
-- Additive and idempotent. Apply after torres_os_foundation.sql.

begin;

create table if not exists public.business_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  client_id uuid not null unique references public.clients(id) on delete cascade,
  legal_name text not null default '',
  display_name text not null check (length(trim(display_name)) > 0),
  vertical text not null default '',
  tagline text not null default '',
  description text not null default '',
  website text not null default '',
  primary_email text not null default '',
  primary_phone text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  location_key text not null default 'primary' check (location_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null default 'Primary location',
  street_address text not null default '',
  city text not null default '',
  region text not null default '',
  postal_code text not null default '',
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  service_area text not null default '',
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, location_key)
);

create table if not exists public.business_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  category text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.business_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  goal_type text not null default 'business' check (goal_type in ('leads', 'revenue', 'appointments', 'visibility', 'reviews', 'operations', 'business')),
  title text not null check (length(trim(title)) > 0),
  target_value numeric,
  target_unit text not null default '',
  target_date date,
  status text not null default 'active' check (status in ('draft', 'active', 'achieved', 'paused', 'archived')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_onboarding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  client_id uuid not null unique references public.clients(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'complete')),
  current_step integer not null default 1 check (current_step between 1 and 5),
  completed_steps text[] not null default '{}'::text[],
  skipped_steps text[] not null default '{}'::text[],
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  step_data jsonb not null default '{}'::jsonb check (jsonb_typeof(step_data) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_locations_organization_idx on public.business_locations (organization_id, is_primary desc);
create index if not exists business_services_organization_idx on public.business_services (organization_id, sort_order, name);
create index if not exists business_goals_organization_idx on public.business_goals (organization_id, status, sort_order);
create index if not exists organization_onboarding_status_idx on public.organization_onboarding (status, updated_at desc);

-- Seed normalized identity and a primary location from the existing client rows.
insert into public.business_profiles (
  organization_id, client_id, legal_name, display_name, vertical, website,
  primary_email, primary_phone, status, created_by, updated_by
)
select
  client_row.organization_id,
  client_row.id,
  client_row.name,
  client_row.name,
  coalesce(client_row.industry, ''),
  coalesce(client_row.website, ''),
  coalesce(client_row.email, ''),
  coalesce(client_row.phone, ''),
  'draft',
  organization_row.created_by,
  organization_row.created_by
from public.clients client_row
join public.organizations organization_row on organization_row.id = client_row.organization_id
where client_row.organization_id is not null
on conflict (organization_id) do nothing;

insert into public.business_locations (
  organization_id, client_id, location_key, name, city, service_area, is_primary
)
select
  client_row.organization_id,
  client_row.id,
  'primary',
  'Primary location',
  coalesce(client_row.location, ''),
  coalesce(client_row.location, ''),
  true
from public.clients client_row
where client_row.organization_id is not null
on conflict (organization_id, location_key) do nothing;

insert into public.organization_onboarding (
  organization_id, client_id, status, current_step, completed_steps,
  completion_percent, step_data
)
select
  client_row.organization_id,
  client_row.id,
  'not_started',
  1,
  '{}'::text[],
  0,
  jsonb_build_object('seeded_from_client', true)
from public.clients client_row
where client_row.organization_id is not null
on conflict (organization_id) do nothing;

alter table public.business_profiles enable row level security;
alter table public.business_locations enable row level security;
alter table public.business_services enable row level security;
alter table public.business_goals enable row level security;
alter table public.organization_onboarding enable row level security;

drop policy if exists "business_profiles_accessible_read" on public.business_profiles;
drop policy if exists "business_profiles_managers_write" on public.business_profiles;
create policy "business_profiles_accessible_read" on public.business_profiles for select to authenticated
using (public.can_access_organization(organization_id));
create policy "business_profiles_managers_write" on public.business_profiles for all to authenticated
using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));

drop policy if exists "business_locations_accessible_read" on public.business_locations;
drop policy if exists "business_locations_managers_write" on public.business_locations;
create policy "business_locations_accessible_read" on public.business_locations for select to authenticated
using (public.can_access_organization(organization_id));
create policy "business_locations_managers_write" on public.business_locations for all to authenticated
using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));

drop policy if exists "business_services_accessible_read" on public.business_services;
drop policy if exists "business_services_managers_write" on public.business_services;
create policy "business_services_accessible_read" on public.business_services for select to authenticated
using (public.can_access_organization(organization_id));
create policy "business_services_managers_write" on public.business_services for all to authenticated
using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));

drop policy if exists "business_goals_accessible_read" on public.business_goals;
drop policy if exists "business_goals_managers_write" on public.business_goals;
create policy "business_goals_accessible_read" on public.business_goals for select to authenticated
using (public.can_access_organization(organization_id));
create policy "business_goals_managers_write" on public.business_goals for all to authenticated
using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));

drop policy if exists "organization_onboarding_accessible_read" on public.organization_onboarding;
drop policy if exists "organization_onboarding_managers_write" on public.organization_onboarding;
create policy "organization_onboarding_accessible_read" on public.organization_onboarding for select to authenticated
using (public.can_access_organization(organization_id));
create policy "organization_onboarding_managers_write" on public.organization_onboarding for all to authenticated
using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));

grant select on public.business_profiles, public.business_locations, public.business_services,
  public.business_goals, public.organization_onboarding to authenticated;

comment on table public.business_profiles is 'Canonical organization-scoped client business identity used by Torres OS.';
comment on table public.business_locations is 'Client locations and service areas. The onboarding flow creates the primary location first.';
comment on table public.business_services is 'Services offered by a client business, ordered for portal and operational use.';
comment on table public.business_goals is 'Client goals that drive reporting, recommendations, and future automation.';
comment on table public.organization_onboarding is 'Resumable organization onboarding state and completion history.';

commit;
