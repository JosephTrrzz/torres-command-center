begin;
-- Apply after studio_publications.sql. No enrollment, scheduler or provider writes.
create table if not exists public.studio_build_attempts (
 id uuid primary key,
 release_id uuid not null references public.studio_publications(id),
 client_id uuid not null references public.studio_sites(client_id),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
 environment text not null check(environment in ('preview','production')),
 branch text not null,
 stage text not null default 'reserved' check(stage in ('reserved','triggering','building','succeeded','failed','ambiguous')),
 provider_deployment_id text unique check(provider_deployment_id ~ '^[a-zA-Z0-9_-]{1,160}$'),
 previous_production_deployment_id text check(previous_production_deployment_id ~ '^[a-zA-Z0-9_-]{1,160}$'),
 preview_attempt_id uuid references public.studio_build_attempts(id),
 preview_evidence jsonb,
 created_at timestamptz not null default now(),
 triggered_at timestamptz,
 updated_at timestamptz not null default now(),
 check((environment='preview' and branch='codex/studio-publish-preview' and preview_attempt_id is null and previous_production_deployment_id is null)
    or (environment='production' and branch='main' and preview_attempt_id is not null and previous_production_deployment_id is not null and preview_evidence is not null)),
 check(stage not in ('building','succeeded') or provider_deployment_id is not null),
 check(provider_deployment_id is null or triggered_at is not null),
 check(stage not in ('triggering','building','ambiguous','succeeded') or triggered_at is not null),
 check(stage<>'reserved' or (triggered_at is null and provider_deployment_id is null)),
 check(stage<>'failed' or triggered_at is null or provider_deployment_id is not null),
 check(environment<>'preview' or stage<>'succeeded' or preview_evidence is not null)
);
-- Ambiguity is active indefinitely: elapsed time is never evidence of cancellation.
create unique index if not exists studio_one_active_build_attempt on public.studio_build_attempts(client_id)
 where stage in ('reserved','triggering','building','ambiguous');
create index if not exists studio_build_attempt_release on public.studio_build_attempts(release_id,created_at);
alter table public.studio_build_attempts enable row level security;
revoke all on public.studio_build_attempts from public,anon,authenticated,service_role;
grant select on public.studio_build_attempts to service_role;

create or replace function public.studio_build_attempt_guard() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare p public.studio_publications; preview public.studio_build_attempts;
begin
 if tg_op='INSERT' then
  select * into p from public.studio_publications where id=new.release_id for update;
  if not found or p.client_id<>new.client_id or p.content_hash is distinct from new.content_hash
   or p.status not in ('queued','deploying','verifying') then
   raise exception 'Build attempt does not match an active publication.';
  end if;
  if new.stage<>'reserved' or new.triggered_at is not null or new.provider_deployment_id is not null then
   raise exception 'Build attempts must begin reserved.';
  end if;
  if new.environment='production' then
   select * into preview from public.studio_build_attempts where id=new.preview_attempt_id;
   if not found or preview.environment<>'preview' or preview.stage<>'succeeded'
    or (preview.release_id,preview.client_id,preview.content_hash,preview.source_commit)
       is distinct from (new.release_id,new.client_id,new.content_hash,new.source_commit)
    or preview.preview_evidence is null or new.preview_evidence is distinct from preview.preview_evidence then
    raise exception 'Production requires verified preview evidence for this exact release and source.';
   end if;
  elsif new.preview_evidence is not null then
   raise exception 'Preview evidence may only be recorded on verified success.';
  end if;
 else
  if (new.id,new.release_id,new.client_id,new.content_hash,new.source_commit,new.environment,new.branch,
      new.previous_production_deployment_id,new.preview_attempt_id,new.created_at)
    is distinct from (old.id,old.release_id,old.client_id,old.content_hash,old.source_commit,old.environment,old.branch,
      old.previous_production_deployment_id,old.preview_attempt_id,old.created_at) then
   raise exception 'Build attempt identity is immutable.';
  end if;
  if old.stage in ('succeeded','failed') then raise exception 'Finished attempts are immutable.'; end if;
  if old.provider_deployment_id is not null and new.provider_deployment_id is distinct from old.provider_deployment_id then
   raise exception 'Provider identity is immutable.';
  end if;
  if old.triggered_at is not null and new.triggered_at is distinct from old.triggered_at then
   raise exception 'Trigger time is immutable.';
  end if;
  if old.preview_evidence is not null and new.preview_evidence is distinct from old.preview_evidence then
   raise exception 'Preview evidence is immutable.';
  end if;
  if not ((old.stage='reserved' and new.stage in ('triggering','failed'))
    or (old.stage='triggering' and new.stage in ('building','ambiguous','failed'))
    or (old.stage='building' and new.stage in ('succeeded','failed','ambiguous'))
    or (old.stage='ambiguous' and new.stage in ('building','succeeded','failed'))) then
   raise exception 'Invalid build attempt transition.';
  end if;
  if old.triggered_at is null and new.triggered_at is not null and not (old.stage='reserved' and new.stage='triggering') then
   raise exception 'Only a claim may set trigger time.';
  end if;
  if old.preview_evidence is null and new.preview_evidence is not null
   and not (new.environment='preview' and new.stage='succeeded') then
   raise exception 'Preview evidence requires verified success.';
  end if;
 end if;
 if new.preview_evidence is not null then
  if jsonb_typeof(new.preview_evidence)<>'object'
   or not (new.preview_evidence ?& array['deployment_id','artifact_hash','verified_at','routes_verified','runtime_verified','functional_verified'])
   or (new.preview_evidence - array['deployment_id','artifact_hash','verified_at','routes_verified','runtime_verified','functional_verified'])<>'{}'::jsonb
   or new.preview_evidence->'routes_verified'<>'true'::jsonb
   or new.preview_evidence->'runtime_verified'<>'true'::jsonb
   or new.preview_evidence->'functional_verified'<>'true'::jsonb
   or jsonb_typeof(new.preview_evidence->'artifact_hash')<>'string'
   or (new.preview_evidence->>'artifact_hash') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(new.preview_evidence->'verified_at')<>'string'
   or not isfinite((new.preview_evidence->>'verified_at')::timestamptz)
   or jsonb_typeof(new.preview_evidence->'deployment_id')<>'string'
   or (new.environment='preview' and (new.preview_evidence->>'deployment_id') is distinct from new.provider_deployment_id) then
   raise exception 'Invalid preview verification evidence.';
  end if;
 end if;
 new.updated_at=clock_timestamp();
 return new;
end $$;
revoke all on function public.studio_build_attempt_guard() from public,anon,authenticated,service_role;
drop trigger if exists studio_build_attempt_guard on public.studio_build_attempts;
create trigger studio_build_attempt_guard before insert or update on public.studio_build_attempts
 for each row execute function public.studio_build_attempt_guard();

create or replace function public.studio_reserve_build_attempt(
 p_id uuid,p_release uuid,p_client uuid,p_hash text,p_source text,p_environment text,p_branch text,
 p_preview uuid default null,p_previous_production text default null
) returns public.studio_build_attempts language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare prior public.studio_build_attempts; evidence jsonb; site public.studio_sites;
begin
 select * into site from public.studio_sites where client_id=p_client for update;
 if not found then raise exception 'Website not found.'; end if;
 select * into prior from public.studio_build_attempts where id=p_id;
 if found then
  if (prior.release_id,prior.client_id,prior.content_hash,prior.source_commit,prior.environment,prior.branch,
      prior.preview_attempt_id,prior.previous_production_deployment_id)
   is distinct from (p_release,p_client,p_hash,p_source,p_environment,p_branch,p_preview,p_previous_production) then
   raise exception 'Attempt identity already used.';
  end if;
  return prior;
 end if;
 if not site.enabled or not site.publishing_enabled then raise exception 'Publishing is disabled.'; end if;
 if p_environment='production' then
  select preview_evidence into evidence from public.studio_build_attempts where id=p_preview;
 end if;
 insert into public.studio_build_attempts(id,release_id,client_id,content_hash,source_commit,environment,branch,
   preview_attempt_id,previous_production_deployment_id,preview_evidence)
 values(p_id,p_release,p_client,p_hash,p_source,p_environment,p_branch,p_preview,p_previous_production,evidence)
 returning * into prior;
 return prior;
end $$;

-- Non-replayable claim: returning zero rows means DO NOT call the create API.
-- A lost response leaves triggering, not a time-expiring reservation to retry.
create or replace function public.studio_claim_build_attempt(p_id uuid,p_client uuid)
returns setof public.studio_build_attempts language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
 perform 1 from public.studio_sites where client_id=p_client and enabled and publishing_enabled for update;
 if not found then return; end if;
 return query update public.studio_build_attempts a set stage='triggering',triggered_at=clock_timestamp()
 where a.id=p_id and a.client_id=p_client and a.stage='reserved'
 and exists(select 1 from public.studio_publications p where p.id=a.release_id and p.status in ('queued','deploying','verifying'))
 returning a.*;
end $$;

-- Called only with independently verified provider/browser evidence. A timeout,
-- missing provider ID or 404 is NOT permission to mark a dispatched attempt failed.
create or replace function public.studio_advance_build_attempt(
 p_id uuid,p_client uuid,p_expected text,p_stage text,p_provider text default null,p_evidence jsonb default null
) returns setof public.studio_build_attempts language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
 if p_stage not in ('building','succeeded','failed','ambiguous') or p_stage is null then
  raise exception 'Use the claim function before creating a deployment.';
 end if;
 return query update public.studio_build_attempts a set stage=p_stage,
  provider_deployment_id=coalesce(p_provider,a.provider_deployment_id),
  preview_evidence=coalesce(p_evidence,a.preview_evidence)
 where a.id=p_id and a.client_id=p_client and a.stage=p_expected returning a.*;
end $$;
revoke all on function public.studio_reserve_build_attempt(uuid,uuid,uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.studio_claim_build_attempt(uuid,uuid) from public,anon,authenticated;
revoke all on function public.studio_advance_build_attempt(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_reserve_build_attempt(uuid,uuid,uuid,text,text,text,text,uuid,text) to service_role;
grant execute on function public.studio_claim_build_attempt(uuid,uuid) to service_role;
grant execute on function public.studio_advance_build_attempt(uuid,uuid,text,text,text,jsonb) to service_role;
comment on table public.studio_build_attempts is 'Private durable build attempts. Claim once before provider creation. Ambiguous work retains the client lock until independently reconciled; no automatic retry or expiry. No credentials or provider payloads.';
commit;
