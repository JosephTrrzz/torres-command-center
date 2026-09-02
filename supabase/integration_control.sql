-- Phase 5 integration control foundation.
-- Stores non-secret connection health and an append-only sync/check history.
-- Provider credentials remain in Cloudflare secrets or provider-specific private tables.

begin;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  scope text not null default 'client' check (scope in ('client', 'organization', 'platform')),
  status text not null default 'disconnected' check (status in ('connected', 'degraded', 'action_required', 'disconnected')),
  account_label text not null default '',
  capabilities text[] not null default '{}',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider)
);

create table if not exists public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid references public.integration_connections(id) on delete set null,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  operation text not null default 'health_check' check (length(trim(operation)) > 0),
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled', 'webhook', 'system')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  records_read integer not null default 0 check (records_read >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  initiated_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists integration_connections_org_status_idx
on public.integration_connections (organization_id, status, updated_at desc);

create index if not exists integration_sync_runs_client_started_idx
on public.integration_sync_runs (client_id, started_at desc);

alter table public.integration_connections enable row level security;
alter table public.integration_sync_runs enable row level security;

drop policy if exists "integration_connections_accessible_read" on public.integration_connections;
create policy "integration_connections_accessible_read" on public.integration_connections for select to authenticated
using (public.can_access_organization(organization_id));

drop policy if exists "integration_sync_runs_accessible_read" on public.integration_sync_runs;
create policy "integration_sync_runs_accessible_read" on public.integration_sync_runs for select to authenticated
using (public.can_access_organization(organization_id));

grant select on public.integration_connections, public.integration_sync_runs to authenticated;

comment on table public.integration_connections is 'Secret-free, client-scoped provider registry and latest verified health state.';
comment on table public.integration_sync_runs is 'Append-only provider health and synchronization execution history.';
comment on column public.integration_connections.metadata is 'Non-secret provider metadata only. Credentials and OAuth tokens are prohibited.';

commit;

