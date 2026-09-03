-- Torres OS Phase 6: immutable, tenant-scoped report snapshots.
-- Additive and idempotent. Apply after provider_metrics.sql and access_control.sql.

begin;

create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_type text not null check (report_type in ('portfolio', 'performance', 'opportunities')),
  period_start date not null,
  period_end date not null,
  comparison_start date not null,
  comparison_end date not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (comparison_end >= comparison_start)
);

create index if not exists report_snapshots_client_created_idx
on public.report_snapshots (client_id, created_at desc);

alter table public.report_snapshots enable row level security;
drop policy if exists "report_snapshots_accessible_read" on public.report_snapshots;
create policy "report_snapshots_accessible_read" on public.report_snapshots for select to authenticated
using (public.can_access_organization(organization_id));

revoke all on public.report_snapshots from anon, authenticated;
grant select on public.report_snapshots to authenticated;

comment on table public.report_snapshots is 'Immutable server-generated report evidence. Browser-supplied metric totals are prohibited.';
comment on column public.report_snapshots.payload is 'Versioned metric totals, comparison totals, coverage, freshness, and definitions generated from trusted observations.';

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_type text not null check (report_type in ('portfolio', 'performance', 'opportunities')),
  recipient_email text not null check (position('@' in recipient_email) > 1),
  cadence text not null check (cadence in ('weekly', 'monthly')),
  next_run_at timestamptz not null,
  enabled boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_schedules_due_idx on public.report_schedules (next_run_at, created_at) where enabled = true and status = 'active';

create table if not exists public.report_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  email_delivery_id uuid references public.email_deliveries(id) on delete set null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('processing', 'sent', 'failed')),
  error_detail text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, scheduled_for)
);

create index if not exists report_schedule_runs_schedule_idx on public.report_schedule_runs (schedule_id, created_at desc);

create or replace function public.enforce_report_delivery_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.clients where id = new.client_id and organization_id = new.organization_id) then
    raise exception 'Report delivery client and organization scope do not match';
  end if;
  if tg_table_name = 'report_schedule_runs' and not exists (
    select 1 from public.report_schedules where id = new.schedule_id and client_id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'Report delivery run and schedule scope do not match';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_report_delivery_scope() from public, anon, authenticated;
drop trigger if exists report_schedules_scope_guard on public.report_schedules;
create trigger report_schedules_scope_guard before insert or update on public.report_schedules for each row execute function public.enforce_report_delivery_scope();
drop trigger if exists report_schedule_runs_scope_guard on public.report_schedule_runs;
create trigger report_schedule_runs_scope_guard before insert or update on public.report_schedule_runs for each row execute function public.enforce_report_delivery_scope();

alter table public.report_schedules enable row level security;
alter table public.report_schedule_runs enable row level security;
drop policy if exists "report_schedules_staff_read" on public.report_schedules;
create policy "report_schedules_staff_read" on public.report_schedules for select to authenticated using (public.can_access_organization(organization_id) and not public.has_organization_role(organization_id, array['client']));
drop policy if exists "report_schedule_runs_staff_read" on public.report_schedule_runs;
create policy "report_schedule_runs_staff_read" on public.report_schedule_runs for select to authenticated using (public.can_access_organization(organization_id) and not public.has_organization_role(organization_id, array['client']));
revoke all on public.report_schedules, public.report_schedule_runs from anon, authenticated;
grant select on public.report_schedules, public.report_schedule_runs to authenticated;

comment on table public.report_schedules is 'Staff-managed recurring report delivery configuration. New schedules are disabled until explicitly enabled.';
comment on table public.report_schedule_runs is 'Idempotent scheduled report attempts linked to immutable snapshots and tracked email delivery.';

commit;
