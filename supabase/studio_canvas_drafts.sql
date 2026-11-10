begin;
-- Standalone additive setup. No accounts/sites are enrolled automatically.
create table if not exists public.studio_sites (
 client_id uuid primary key references public.clients(id),
 name text not null check(length(name) between 1 and 120),
 public_url text check(public_url is null or public_url ~ '^https://'),
 enabled boolean not null default false
);
alter table public.studio_sites enable row level security;
revoke all on public.studio_sites from public,anon,authenticated;
grant select on public.studio_sites to service_role;
alter table public.studio_sites add column if not exists canvas_snapshot_id text;
create table if not exists public.studio_canvas_drafts (
 client_id uuid not null references public.studio_sites(client_id),
 snapshot_id text not null check(snapshot_id ~ '^[a-f0-9]{64}$'),
 revision integer not null check(revision > 0),
 draft jsonb not null check(jsonb_typeof(draft)='object' and octet_length(draft::text)<=4500000),
 actor_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(client_id,snapshot_id,revision)
);
alter table public.studio_canvas_drafts enable row level security;
revoke all on public.studio_canvas_drafts from public,anon,authenticated,service_role;
grant select,insert on public.studio_canvas_drafts to service_role;
comment on table public.studio_canvas_drafts is 'Private visual-editor snapshots, scoped to a client and source snapshot. Append-only; not a publication feed. Browser access is denied; authenticated Functions enforce membership.';
comment on column public.studio_sites.canvas_snapshot_id is 'Operator-approved source snapshot for visual editing. NULL disables the visual editor. Existing website content-only permissions are unchanged.';
commit;
