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
create policy "Authenticated users can view client people" on public.client_people for select to authenticated using (true);
drop policy if exists "Authenticated users can add client people" on public.client_people;
create policy "Authenticated users can add client people" on public.client_people for insert to authenticated with check (true);
drop policy if exists "Authenticated users can update client people" on public.client_people;
create policy "Authenticated users can update client people" on public.client_people for update to authenticated using (true) with check (true);
drop policy if exists "Authenticated users can delete client people" on public.client_people;
create policy "Authenticated users can delete client people" on public.client_people for delete to authenticated using (true);
