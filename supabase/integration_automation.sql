-- Phase 5 automated integration health checks and failure-alert state.
-- The scheduler secret is stored in Supabase Vault and Cloudflare, never here.

begin;

alter table public.integration_connections
  add column if not exists automation_enabled boolean not null default true,
  add column if not exists check_interval_minutes integer not null default 360,
  add column if not exists next_check_at timestamptz not null default now(),
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists alert_opened_at timestamptz,
  add column if not exists alert_resolved_at timestamptz,
  add column if not exists last_trigger text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integration_connections_check_interval_check'
      and conrelid = 'public.integration_connections'::regclass
  ) then
    alter table public.integration_connections
      add constraint integration_connections_check_interval_check
      check (check_interval_minutes between 15 and 10080);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'integration_connections_failures_check'
      and conrelid = 'public.integration_connections'::regclass
  ) then
    alter table public.integration_connections
      add constraint integration_connections_failures_check
      check (consecutive_failures >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'integration_connections_last_trigger_check'
      and conrelid = 'public.integration_connections'::regclass
  ) then
    alter table public.integration_connections
      add constraint integration_connections_last_trigger_check
      check (last_trigger is null or last_trigger in ('manual', 'scheduled', 'webhook', 'system'));
  end if;
end
$$;

create index if not exists integration_connections_due_idx
on public.integration_connections (next_check_at, organization_id)
where automation_enabled = true;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.invoke_integration_health_scheduler()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  scheduler_url text;
  scheduler_secret text;
  request_id bigint;
begin
  select decrypted_secret into scheduler_url
  from vault.decrypted_secrets
  where name = 'integration_scheduler_url'
  limit 1;

  select decrypted_secret into scheduler_secret
  from vault.decrypted_secrets
  where name = 'integration_scheduler_secret'
  limit 1;

  if coalesce(length(trim(scheduler_url)), 0) = 0
    or coalesce(length(trim(scheduler_secret)), 0) < 32 then
    return null;
  end if;

  select net.http_post(
    url := scheduler_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-torres-cron-secret', scheduler_secret
    ),
    body := jsonb_build_object('source', 'supabase-cron'),
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_integration_health_scheduler() from public;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'torres-integration-health-hourly') then
    perform cron.schedule(
      'torres-integration-health-hourly',
      '17 * * * *',
      $schedule$select public.invoke_integration_health_scheduler();$schedule$
    );
  end if;
end
$$;

comment on function public.invoke_integration_health_scheduler() is
  'Calls the protected Torres OS integration health endpoint using secrets stored in Supabase Vault.';

commit;
