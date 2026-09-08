create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  portal_email text not null,
  portal_enabled boolean not null default false,
  portal_status text not null default 'invited' check (portal_status in ('invited','active','paused','revoked')),
  billing_email text not null default '',
  billing_status text not null default 'not_connected' check (billing_status in ('not_connected','pending','active','past_due','canceled')),
  square_customer_id text,
  square_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_accounts enable row level security;
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
