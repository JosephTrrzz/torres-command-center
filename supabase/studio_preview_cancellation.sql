begin;
-- Apply after studio_build_attempts.sql. Operator SQL only; no service/browser RPC.
-- Cancellation revokes Studio approval, NOT a claim about provider termination.
-- A late preview may finish, but this release can never authorize production.
alter table public.studio_build_attempts add column if not exists cancelled_at timestamptz;
alter table public.studio_build_attempts add column if not exists cancellation_reason text;
alter table public.studio_build_attempts add column if not exists cancellation_actor text;
alter table public.studio_build_attempts drop constraint studio_build_attempts_stage_check;
alter table public.studio_build_attempts add constraint studio_build_attempts_stage_check
 check(stage in ('reserved','triggering','building','succeeded','failed','ambiguous','cancelled'));
-- The existing active-attempt index deliberately excludes cancelled.
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
  if old.stage in ('succeeded','failed','cancelled') then raise exception 'Finished attempts are immutable.'; end if;
  if old.provider_deployment_id is not null and new.provider_deployment_id is distinct from old.provider_deployment_id then
   raise exception 'Provider identity is immutable.';
  end if;
  if old.triggered_at is not null and new.triggered_at is distinct from old.triggered_at then
   raise exception 'Trigger time is immutable.';
  end if;
  if old.preview_evidence is not null and new.preview_evidence is distinct from old.preview_evidence then
   raise exception 'Preview evidence is immutable.';
  end if;
  if not ((new.stage='cancelled' and new.environment='preview' and old.stage in ('reserved','triggering','building','ambiguous'))
    or (old.stage='reserved' and new.stage in ('triggering','failed'))
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
 if new.stage='cancelled' then
  if new.environment<>'preview' or new.cancelled_at is null or new.cancellation_reason is null
   or length(btrim(new.cancellation_reason)) not between 1 and 1000 or new.cancellation_actor is null
   or not exists(select 1 from public.studio_publications where id=new.release_id and client_id=new.client_id and status='failed')
   or exists(select 1 from public.studio_build_attempts where release_id=new.release_id and environment='production') then
   raise exception 'Preview cancellation requires failed parent and no production attempt.';
  end if;
 elsif new.cancelled_at is not null or new.cancellation_reason is not null or new.cancellation_actor is not null then
  raise exception 'Cancellation metadata requires operator cancellation.';
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

create or replace function public.studio_cancel_preview_attempt(
 p_id uuid,p_client uuid,p_release uuid,p_hash text,p_source text,p_expected text,p_reason text
) returns public.studio_build_attempts language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare a public.studio_build_attempts; p public.studio_publications;
begin
 if p_expected is null or p_expected not in ('reserved','triggering','building','ambiguous')
  or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
  raise exception 'Expected active preview stage and operator reason are required.';
 end if;
 -- Same lock order as reservation: site, publication, attempt. No competing
 -- production reservation can pass the site's lock while cancellation commits.
 perform 1 from public.studio_sites where client_id=p_client for update;
 if not found then raise exception 'Website not found.'; end if;
 select * into p from public.studio_publications where id=p_release and client_id=p_client for update;
 if not found or p.status not in ('queued','deploying','verifying') then
  raise exception 'Active publication required.';
 end if;
 select * into a from public.studio_build_attempts where id=p_id and client_id=p_client for update;
 if not found or (a.release_id,a.content_hash,a.source_commit,a.stage,a.environment)
  is distinct from (p_release,p_hash,p_source,p_expected,'preview'::text)
  or a.content_hash is distinct from p.content_hash then
  raise exception 'Exact active preview identity required.';
 end if;
 if exists(select 1 from public.studio_build_attempts where release_id=p_release and environment='production') then
  raise exception 'A release with a production attempt cannot be cancelled here.';
 end if;
 update public.studio_publications set status='failed' where id=p_release;
 update public.studio_build_attempts set stage='cancelled',cancelled_at=clock_timestamp(),
  cancellation_reason=btrim(p_reason),cancellation_actor=session_user
 where id=p_id returning * into a;
 return a;
end $$;
revoke all on function public.studio_cancel_preview_attempt(uuid,uuid,uuid,text,text,text,text)
 from public,anon,authenticated,service_role;
commit;
