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

commit;
