-- Phase 5 normalized provider metrics.
-- Stores provider observations without credentials or raw provider payloads.

begin;

create table if not exists public.provider_metric_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  provider text not null check (provider in ('google_analytics', 'google_search_console')),
  resource_id text not null check (length(trim(resource_id)) > 0),
  metric_key text not null check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  period_start date not null,
  period_end date not null,
  value numeric not null,
  unit text not null check (unit in ('count', 'ratio', 'rank')),
  observed_at timestamptz not null,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint provider_metric_observations_period_check check (period_end >= period_start),
  unique (client_id, provider, resource_id, metric_key, period_start, period_end)
);

create index if not exists provider_metric_observations_client_period_idx
on public.provider_metric_observations (client_id, period_start desc, provider, metric_key);

create index if not exists provider_metric_observations_org_synced_idx
on public.provider_metric_observations (organization_id, synced_at desc);

create or replace function public.enforce_provider_metric_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.clients
    where id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'Provider metric client and organization scope do not match';
  end if;

  if new.connection_id is not null and not exists (
    select 1 from public.integration_connections
    where id = new.connection_id
      and client_id = new.client_id
      and organization_id = new.organization_id
  ) then
    raise exception 'Provider metric connection scope does not match';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_provider_metric_scope() from public, anon, authenticated;

drop trigger if exists provider_metric_observations_scope_guard on public.provider_metric_observations;
create trigger provider_metric_observations_scope_guard
before insert or update on public.provider_metric_observations
for each row execute function public.enforce_provider_metric_scope();

alter table public.provider_metric_observations enable row level security;

drop policy if exists "provider_metric_observations_accessible_read" on public.provider_metric_observations;
create policy "provider_metric_observations_accessible_read"
on public.provider_metric_observations for select to authenticated
using (public.can_access_organization(organization_id));

revoke insert, update, delete on public.provider_metric_observations from anon, authenticated;
grant select on public.provider_metric_observations to authenticated;

comment on table public.provider_metric_observations is
  'Tenant-scoped, normalized provider metrics. OAuth tokens and raw provider responses are prohibited.';
comment on column public.provider_metric_observations.resource_id is
  'Mapped provider resource identifier, such as a GA4 property or Search Console site.';
comment on column public.provider_metric_observations.metadata is
  'Small, non-secret normalization metadata only; raw provider payloads are prohibited.';

commit;
