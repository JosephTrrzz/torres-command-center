-- Torres OS Phase 3: customer 360, jobs, estimates, documents, and calendar operations.
-- Additive and idempotent. Apply after crm.sql and client_projects.sql.

begin;

insert into public.permissions (key, name, description) values
  ('operations.read', 'Read operations', 'View customer, job, schedule, estimate, document, and activity records.'),
  ('operations.manage', 'Manage operations', 'Create and update jobs, schedules, estimates, documents, and customer operations.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role, permission_key)
select role_name, permission_key
from (values
  ('owner', 'operations.read'), ('owner', 'operations.manage'),
  ('admin', 'operations.read'), ('admin', 'operations.manage'),
  ('operator', 'operations.read'), ('operator', 'operations.manage'),
  ('member', 'operations.read'),
  ('viewer', 'operations.read'),
  ('client', 'operations.read')
) as role_map(role_name, permission_key)
on conflict do nothing;

create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  project_id uuid references public.client_projects(id) on delete set null,
  job_number text not null,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status text not null default 'requested' check (status in ('requested', 'scheduled', 'in_progress', 'waiting', 'completed', 'canceled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  location_id uuid references public.business_locations(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  client_visible boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_number),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);

create unique index if not exists service_jobs_lead_once_idx on public.service_jobs (lead_id) where lead_id is not null;
create index if not exists service_jobs_client_status_idx on public.service_jobs (client_id, status, scheduled_start, updated_at desc);
create index if not exists service_jobs_assignee_idx on public.service_jobs (assigned_to, status, scheduled_start);

alter table public.crm_tasks add column if not exists job_id uuid references public.service_jobs(id) on delete cascade;
create index if not exists crm_tasks_job_status_idx on public.crm_tasks (job_id, status, due_at) where job_id is not null;

create table if not exists public.job_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  activity_type text not null check (length(trim(activity_type)) > 0),
  title text not null check (length(trim(title)) > 0),
  detail text not null default '',
  client_visible boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists job_activities_job_created_idx on public.job_activities (job_id, created_at desc);

create table if not exists public.job_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  estimate_number text not null,
  title text not null check (length(trim(title)) > 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  expires_at date,
  notes text not null default '',
  client_visible boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, estimate_number),
  check (total = subtotal + tax)
);

create index if not exists job_estimates_job_status_idx on public.job_estimates (job_id, status, created_at desc);

create table if not exists public.job_estimate_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  estimate_id uuid not null references public.job_estimates(id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  check (amount = round(quantity * unit_price, 2))
);

create index if not exists job_estimate_items_estimate_order_idx on public.job_estimate_items (estimate_id, sort_order);

create table if not exists public.job_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  estimate_id uuid references public.job_estimates(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  document_type text not null default 'other' check (document_type in ('proposal', 'contract', 'invoice', 'report', 'photo', 'other')),
  status text not null default 'draft' check (status in ('draft', 'shared', 'approved', 'archived')),
  resource_url text not null check (resource_url ~ '^https?://'),
  version integer not null default 1 check (version > 0),
  client_visible boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_documents_job_status_idx on public.job_documents (job_id, status, created_at desc);

alter table public.service_jobs enable row level security;
alter table public.job_activities enable row level security;
alter table public.job_estimates enable row level security;
alter table public.job_estimate_items enable row level security;
alter table public.job_documents enable row level security;

drop policy if exists "service_jobs_accessible_read" on public.service_jobs;
create policy "service_jobs_accessible_read" on public.service_jobs for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (client_visible and client_id = public.current_client_id())
  )
);

drop policy if exists "job_activities_accessible_read" on public.job_activities;
create policy "job_activities_accessible_read" on public.job_activities for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (client_visible and client_id = public.current_client_id())
  )
);

drop policy if exists "job_estimates_accessible_read" on public.job_estimates;
create policy "job_estimates_accessible_read" on public.job_estimates for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (client_visible and client_id = public.current_client_id())
  )
);

drop policy if exists "job_estimate_items_accessible_read" on public.job_estimate_items;
create policy "job_estimate_items_accessible_read" on public.job_estimate_items for select to authenticated
using (exists (
  select 1
  from public.job_estimates estimate
  where estimate.id = estimate_id
    and public.can_access_organization(estimate.organization_id)
    and (
      not public.has_organization_role(estimate.organization_id, array['client'])
      or (estimate.client_visible and estimate.client_id = public.current_client_id())
    )
));

drop policy if exists "job_documents_accessible_read" on public.job_documents;
create policy "job_documents_accessible_read" on public.job_documents for select to authenticated
using (
  public.can_access_organization(organization_id)
  and (
    not public.has_organization_role(organization_id, array['client'])
    or (client_visible and client_id = public.current_client_id())
  )
);

-- Mutations use the protected Pages Function so authorization, validation,
-- notifications, audit history, and outbox events stay at one server boundary.
revoke all on public.service_jobs, public.job_activities, public.job_estimates, public.job_estimate_items, public.job_documents from anon;
revoke all on public.service_jobs, public.job_activities, public.job_estimates, public.job_estimate_items, public.job_documents from authenticated;
grant select on public.service_jobs, public.job_activities, public.job_estimates, public.job_estimate_items, public.job_documents to authenticated;

comment on table public.service_jobs is 'Client service requests and operational jobs converted from leads or created directly by authorized staff.';
comment on table public.job_activities is 'Immutable job timeline entries with explicit client visibility.';
comment on table public.job_estimates is 'Versionable client estimates with server-calculated totals and an explicit response lifecycle.';
comment on table public.job_estimate_items is 'Server-validated estimate line items used to calculate subtotal, tax, and total.';
comment on table public.job_documents is 'Previewable job document metadata linked to an HTTPS resource; file bytes remain with the approved storage provider.';
comment on column public.crm_tasks.job_id is 'Optional service-job relationship used by the shared operations calendar and job checklist.';

commit;
