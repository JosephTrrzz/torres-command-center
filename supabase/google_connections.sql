create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  google_email text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  business_profile_location text,
  search_console_site text,
  analytics_property text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;
