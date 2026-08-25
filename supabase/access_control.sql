-- Torres Command Center role and tenant access foundation.
-- Run once in the Supabase SQL Editor after reviewing the owner email below.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'customer' check (role in ('owner', 'employee', 'customer')),
  client_id uuid references public.clients(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

-- Establish the initial owner. Change this address first if your Supabase login differs.
update public.profiles
set role = 'owner', active = true, updated_at = now()
where lower(email) = lower('joseph@torrescotechnology.com');

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.current_client_id()
returns uuid language sql stable security definer set search_path = public
as $$ select client_id from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() in ('owner', 'employee'), false) $$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_app_role() = 'owner', false) $$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.current_app_role() from public;
revoke all on function public.current_client_id() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_owner() from public;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_client_id() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_people enable row level security;
alter table public.customer_accounts enable row level security;

-- Replace any older permissive policies so these role boundaries are authoritative.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'clients', 'client_people', 'customer_accounts')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

drop policy if exists "profiles_self_read" on public.profiles;
drop policy if exists "profiles_staff_read" on public.profiles;
drop policy if exists "profiles_owner_manage" on public.profiles;
create policy "profiles_self_read" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "profiles_staff_read" on public.profiles for select to authenticated
using (public.is_staff());
create policy "profiles_owner_manage" on public.profiles for all to authenticated
using (public.is_owner()) with check (public.is_owner());

drop policy if exists "clients_staff_read" on public.clients;
drop policy if exists "clients_staff_insert" on public.clients;
drop policy if exists "clients_staff_update" on public.clients;
drop policy if exists "clients_owner_delete" on public.clients;
drop policy if exists "clients_customer_read" on public.clients;
create policy "clients_staff_read" on public.clients for select to authenticated
using (public.is_staff());
create policy "clients_staff_insert" on public.clients for insert to authenticated
with check (public.is_staff());
create policy "clients_staff_update" on public.clients for update to authenticated
using (public.is_staff()) with check (public.is_staff());
create policy "clients_owner_delete" on public.clients for delete to authenticated
using (public.is_owner());
create policy "clients_customer_read" on public.clients for select to authenticated
using (id = public.current_client_id());

drop policy if exists "people_staff_manage" on public.client_people;
drop policy if exists "people_customer_read" on public.client_people;
create policy "people_staff_manage" on public.client_people for all to authenticated
using (public.is_staff()) with check (public.is_staff());
create policy "people_customer_read" on public.client_people for select to authenticated
using (client_id = public.current_client_id());

drop policy if exists "accounts_staff_manage" on public.customer_accounts;
drop policy if exists "accounts_customer_read" on public.customer_accounts;
create policy "accounts_staff_manage" on public.customer_accounts for all to authenticated
using (public.is_staff()) with check (public.is_staff());
create policy "accounts_customer_read" on public.customer_accounts for select to authenticated
using (client_id = public.current_client_id());

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.client_people to authenticated;
grant select, insert, update, delete on public.customer_accounts to authenticated;
