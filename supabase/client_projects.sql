-- Torres OS Phase 2: organization-scoped projects, milestones, deliverables, and client requests.
-- Additive and idempotent. Apply after client_onboarding.sql.

begin;

create table if not exists public.client_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  summary text not null default '',
  status text not null default 'planned' check (status in ('planned', 'active', 'blocked', 'completed', 'archived')),
  start_date date,
  target_date date,
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  owner_user_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_date is null or start_date is null or target_date >= start_date)
);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.client_projects(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'complete')),
  due_date date,
  sort_order integer not null default 0 check (sort_order >= 0),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.client_projects(id) on delete cascade,
  milestone_id uuid references public.project_milestones(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'delivered')),
  resource_url text,
  due_date date,
  delivered_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.client_projects(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  requested_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_projects_client_status_idx on public.client_projects (client_id, status, updated_at desc);
create index if not exists project_milestones_project_order_idx on public.project_milestones (project_id, sort_order, due_date);
create index if not exists project_deliverables_project_status_idx on public.project_deliverables (project_id, status, due_date);
create index if not exists client_requests_client_status_idx on public.client_requests (client_id, status, created_at desc);

alter table public.client_projects enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_deliverables enable row level security;
alter table public.client_requests enable row level security;

drop policy if exists "client_projects_accessible_read" on public.client_projects;
create policy "client_projects_accessible_read" on public.client_projects for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "project_milestones_accessible_read" on public.project_milestones;
create policy "project_milestones_accessible_read" on public.project_milestones for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "project_deliverables_accessible_read" on public.project_deliverables;
create policy "project_deliverables_accessible_read" on public.project_deliverables for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "client_requests_accessible_read" on public.client_requests;
create policy "client_requests_accessible_read" on public.client_requests for select to authenticated
using (public.can_access_organization(organization_id));

-- Mutations intentionally use authenticated Pages Functions so validation, authorization,
-- audit history, and event-outbox writes happen together at one server boundary.
revoke all on public.client_projects, public.project_milestones, public.project_deliverables, public.client_requests from anon;
revoke all on public.client_projects, public.project_milestones, public.project_deliverables, public.client_requests from authenticated;
grant select on public.client_projects, public.project_milestones, public.project_deliverables, public.client_requests to authenticated;

comment on table public.client_projects is 'Client implementation and service projects visible to the agency and authorized client members.';
comment on column public.client_projects.progress_percent is 'Cached milestone completion percentage; recalculated by the protected project API after milestone changes.';
comment on table public.project_milestones is 'Ordered, measurable project checkpoints used to calculate transparent project progress.';
comment on table public.project_deliverables is 'Client-visible project outputs and their review or delivery state.';
comment on table public.client_requests is 'Requests submitted by clients or agency staff and tracked through resolution.';

commit;
