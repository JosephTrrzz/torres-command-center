-- Private Apple Calendar subscriptions for Operations schedules.
-- Tokens are returned once; only their SHA-256 hashes are stored.

begin;

create table if not exists public.calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'apple' check (provider = 'apple'),
  token_hash text not null unique check (length(token_hash) = 64),
  include_private boolean not null default false,
  active boolean not null default true,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id, provider)
);

create index if not exists calendar_subscriptions_client_idx
on public.calendar_subscriptions (client_id, active, updated_at desc);

alter table public.calendar_subscriptions enable row level security;
revoke all on public.calendar_subscriptions from anon, authenticated;

comment on table public.calendar_subscriptions is
  'Revocable private calendar-feed grants. Raw subscription tokens are never stored.';

commit;
