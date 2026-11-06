begin;
create table if not exists public.website_homepages (
  client_id uuid primary key references public.clients(id) on delete cascade,
  revision integer not null default 0,
  draft jsonb,
  published jsonb
);
alter table public.website_homepages enable row level security;
revoke all on public.website_homepages from public, anon, authenticated;
grant select, update, insert on public.website_homepages to service_role;
insert into public.website_homepages(client_id)
select id from public.clients where id = '06edc104-71e0-4359-8cb3-42529d65b5d1'
on conflict do nothing;
commit;
