begin;
-- Operator enrollment only. Never enables publishing for an existing site implicitly.
alter table public.studio_sites add column if not exists publishing_enabled boolean not null default false;
create table if not exists public.studio_publications (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.studio_sites(client_id),
 snapshot_id text not null,
 revision integer not null,
 actor_id uuid not null,
 request_key uuid not null,
 status text not null default 'queued' check(status in ('queued','deploying','verifying','live','failed')),
 content_hash text check(content_hash ~ '^[a-f0-9]{64}$'),
 deployment_id text,
 created_at timestamptz not null default now(),
 verified_at timestamptz,
 next_check_at timestamptz not null default now(),
 foreign key(client_id,snapshot_id,revision) references public.studio_canvas_drafts(client_id,snapshot_id,revision),
 unique(client_id,request_key),
 unique(client_id,snapshot_id,revision)
);
create or replace function public.studio_publication_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if (new.id,new.client_id,new.snapshot_id,new.revision,new.actor_id,new.request_key,new.created_at)
 is distinct from (old.id,old.client_id,old.snapshot_id,old.revision,old.actor_id,old.request_key,old.created_at)
 then raise exception 'Publication identity is immutable.'; end if;
 if old.content_hash is not null and new.content_hash is distinct from old.content_hash then raise exception 'Release content is immutable.'; end if;
 if old.deployment_id is not null and new.deployment_id is distinct from old.deployment_id then raise exception 'Deployment identity is immutable.'; end if;
 if (old.status in ('live','failed') and new.status<>old.status)
 or (old.status='deploying' and new.status='queued')
 or (old.status='verifying' and new.status in ('queued','deploying'))
 or (new.status='live' and (old.status not in ('verifying','live') or new.verified_at is null or new.content_hash is null or new.deployment_id is null))
 then raise exception 'Invalid publication transition.'; end if;
 return new;
end $$;
revoke all on function public.studio_publication_guard() from public,anon,authenticated;
drop trigger if exists studio_publication_guard on public.studio_publications;
create trigger studio_publication_guard before update on public.studio_publications for each row execute function public.studio_publication_guard();
create unique index if not exists studio_one_active_publication on public.studio_publications(client_id) where status in ('queued','deploying','verifying');
alter table public.studio_publications enable row level security;
revoke all on public.studio_publications from public,anon,authenticated,service_role;
grant select,update on public.studio_publications to service_role;
create or replace function public.studio_begin_publication(p_client uuid,p_actor uuid,p_snapshot text,p_revision integer,p_key uuid)
returns public.studio_publications language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_sites; prior public.studio_publications; latest integer;
begin
 select * into s from public.studio_sites where client_id=p_client for update;
 if not found or not s.enabled or not s.publishing_enabled or s.canvas_snapshot_id is distinct from p_snapshot then
  raise exception 'Publishing is not enabled for this website.' using errcode='P0001';
 end if;
 select * into prior from public.studio_publications where client_id=p_client and request_key=p_key;
 if found then
  if prior.snapshot_id<>p_snapshot or prior.revision<>p_revision then raise exception 'Request key already used.' using errcode='P0001'; end if;
  return prior;
 end if;
 select max(revision) into latest from public.studio_canvas_drafts where client_id=p_client and snapshot_id=p_snapshot;
 if latest is distinct from p_revision then raise exception 'Save and review the latest draft before publishing.' using errcode='P0001'; end if;
 select * into prior from public.studio_publications where client_id=p_client and snapshot_id=p_snapshot and revision=p_revision;
 if found then return prior; end if;
 if exists(select 1 from public.studio_publications where client_id=p_client and status in ('queued','deploying','verifying')) then
  raise exception 'A publication is already in progress.' using errcode='P0001';
 end if;
 if exists(select 1 from public.studio_publications where client_id=p_client and created_at>now()-interval '30 seconds') then
  raise exception 'Please wait before publishing again.' using errcode='P0001';
 end if;
 insert into public.studio_publications(client_id,snapshot_id,revision,actor_id,request_key)
 values(p_client,p_snapshot,p_revision,p_actor,p_key) returning * into prior;
 return prior;
end $$;
revoke all on function public.studio_begin_publication(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.studio_begin_publication(uuid,uuid,text,integer,uuid) to service_role;
comment on table public.studio_publications is 'Private publishing ledger. Immutable draft reference and actor; only verified deployed revisions are live. No browser grants. One active publication per assigned site.';
comment on column public.studio_sites.publishing_enabled is 'Operator gate. Enable only after a snapshot-compatible safe renderer, durable idempotent deployment adapter, and public release-marker verification are installed.';
commit;
