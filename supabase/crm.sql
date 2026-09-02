-- Torres OS Phase 3 CRM vertical slice.
-- Durable, tenant-scoped records for website leads, assignment, appointments,
-- follow-up tasks, and the customer activity timeline. No demo data is inserted.

begin;

insert into public.permissions (key, name, description) values
  ('crm.read', 'Read CRM', 'View organization-scoped leads, appointments, tasks, and activity.'),
  ('crm.manage', 'Manage CRM', 'Create, assign, schedule, and complete organization-scoped CRM work.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role, permission_key)
select role_name, permission_key
from (values
  ('owner', 'crm.read'), ('owner', 'crm.manage'),
  ('admin', 'crm.read'), ('admin', 'crm.manage'),
  ('operator', 'crm.read'), ('operator', 'crm.manage'),
  ('member', 'crm.read'),
  ('viewer', 'crm.read')
) as role_map(role_name, permission_key)
on conflict do nothing;

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  service_interest text not null default '',
  message text not null default '',
  source text not null default 'website' check (source in ('website', 'referral', 'phone', 'email', 'social', 'other')),
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'appointment_scheduled', 'won', 'lost')),
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email <> '' or phone <> '')
);

alter table public.crm_leads add column if not exists is_pinned boolean not null default false;
alter table public.crm_leads add column if not exists pinned_at timestamptz;

create table if not exists public.crm_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Los_Angeles',
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'canceled', 'no_show')),
  location text not null default '',
  notes text not null default '',
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  appointment_id uuid references public.crm_appointments(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'canceled')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  activity_type text not null check (length(trim(activity_type)) > 0),
  title text not null check (length(trim(title)) > 0),
  detail text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_leads_client_status_idx on public.crm_leads (client_id, status, created_at desc);
create index if not exists crm_leads_assignee_idx on public.crm_leads (assigned_to, status, updated_at desc);
create index if not exists crm_leads_client_pin_idx on public.crm_leads (client_id, is_pinned desc, pinned_at desc, created_at desc);
create index if not exists crm_appointments_client_starts_idx on public.crm_appointments (client_id, starts_at, status);
create index if not exists crm_tasks_client_due_idx on public.crm_tasks (client_id, status, due_at);
create index if not exists crm_activities_lead_created_idx on public.crm_activities (lead_id, created_at desc);

alter table public.crm_leads enable row level security;
alter table public.crm_appointments enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_activities enable row level security;

drop policy if exists "crm_leads_accessible_read" on public.crm_leads;
create policy "crm_leads_accessible_read" on public.crm_leads for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "crm_appointments_accessible_read" on public.crm_appointments;
create policy "crm_appointments_accessible_read" on public.crm_appointments for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "crm_tasks_accessible_read" on public.crm_tasks;
create policy "crm_tasks_accessible_read" on public.crm_tasks for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "crm_activities_accessible_read" on public.crm_activities;
create policy "crm_activities_accessible_read" on public.crm_activities for select to authenticated
using (public.can_access_organization(organization_id));

-- All writes cross the protected Pages Function boundary so authorization,
-- validation, audit history, outbox events, and notifications stay together.
revoke all on public.crm_leads, public.crm_appointments, public.crm_tasks, public.crm_activities from anon;
revoke all on public.crm_leads, public.crm_appointments, public.crm_tasks, public.crm_activities from authenticated;
grant select on public.crm_leads, public.crm_appointments, public.crm_tasks, public.crm_activities to authenticated;

comment on table public.crm_leads is 'Leads captured for a client business and moved through the agency-managed sales pipeline.';
comment on column public.crm_leads.is_pinned is 'Keeps an important lead at the top of its pipeline stage without changing its workflow status.';
comment on column public.crm_leads.pinned_at is 'Records when a lead was pinned so recently pinned leads can be ordered first.';
comment on table public.crm_appointments is 'Scheduled sales or service appointments connected to a lead and client workspace.';
comment on table public.crm_tasks is 'Assigned follow-up work tied to a lead or appointment, with explicit due and completion state.';
comment on table public.crm_activities is 'Immutable lead timeline entries produced by protected CRM workflows.';

commit;
