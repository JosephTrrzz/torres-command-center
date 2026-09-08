-- Torres OS security hardening: repair legacy grants and make public chat throttling atomic.
-- Additive and idempotent. Apply after access_control.sql and ai_receptionist.sql.

begin;

alter table public.customer_accounts enable row level security;
alter table public.client_people enable row level security;
drop policy if exists "Authenticated users can view customer accounts" on public.customer_accounts;
drop policy if exists "Authenticated users can create customer accounts" on public.customer_accounts;
drop policy if exists "Authenticated users can update customer accounts" on public.customer_accounts;
drop policy if exists "accounts_staff_manage" on public.customer_accounts;
drop policy if exists "accounts_customer_read" on public.customer_accounts;
create policy "accounts_staff_manage" on public.customer_accounts for all to authenticated
using (public.is_staff()) with check (public.is_staff());
create policy "accounts_customer_read" on public.customer_accounts for select to authenticated
using (client_id = public.current_client_id());
revoke all on public.customer_accounts from anon, authenticated;
grant select, insert, update, delete on public.customer_accounts to authenticated;

drop policy if exists "Authenticated users can view client people" on public.client_people;
drop policy if exists "Authenticated users can add client people" on public.client_people;
drop policy if exists "Authenticated users can update client people" on public.client_people;
drop policy if exists "Authenticated users can delete client people" on public.client_people;
drop policy if exists "people_staff_manage" on public.client_people;
drop policy if exists "people_customer_read" on public.client_people;
create policy "people_staff_manage" on public.client_people for all to authenticated
using (public.is_staff()) with check (public.is_staff());
create policy "people_customer_read" on public.client_people for select to authenticated
using (client_id = public.current_client_id());
revoke all on public.client_people from anon, authenticated;
grant select, insert, update, delete on public.client_people to authenticated;

create or replace function public.claim_receptionist_rate_limit(
  p_bucket_hash text,
  p_window_start timestamptz,
  p_limit integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if p_bucket_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_limit > 300 then
    return false;
  end if;
  insert into public.receptionist_rate_limits (bucket_hash, window_start, request_count, updated_at)
  values (p_bucket_hash, date_trunc('minute', p_window_start), 1, now())
  on conflict (bucket_hash, window_start) do update
    set request_count = public.receptionist_rate_limits.request_count + 1,
        updated_at = now()
    where public.receptionist_rate_limits.request_count < p_limit
  returning request_count into next_count;
  return coalesce(next_count <= p_limit, false);
end;
$$;

revoke all on function public.claim_receptionist_rate_limit(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_receptionist_rate_limit(text, timestamptz, integer) to service_role;

commit;
