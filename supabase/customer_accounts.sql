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
create policy "Authenticated users can view customer accounts" on public.customer_accounts for select to authenticated using (true);
drop policy if exists "Authenticated users can create customer accounts" on public.customer_accounts;
create policy "Authenticated users can create customer accounts" on public.customer_accounts for insert to authenticated with check (true);
drop policy if exists "Authenticated users can update customer accounts" on public.customer_accounts;
create policy "Authenticated users can update customer accounts" on public.customer_accounts for update to authenticated using (true) with check (true);
