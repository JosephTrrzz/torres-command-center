create table if not exists public.client_people (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  role text not null default '',
  email text not null default '',
  phone text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
alter table public.client_people enable row level security;
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
