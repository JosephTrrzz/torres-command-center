-- Apply after studio_publications.sql. No client site is enabled by this migration.
-- Store studio_publication_scheduler_secret in Vault and the matching
-- STUDIO_CRON_SECRET in the Command Center's encrypted environment.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.invoke_studio_publication_scheduler()
returns bigint language plpgsql security definer
set search_path=pg_catalog,public,extensions as $$
declare scheduler_secret text; request_id bigint;
begin
 if not exists(select 1 from public.studio_publications
   where status in ('queued','deploying','verifying') and next_check_at<=now()) then
   return null;
 end if;
 select decrypted_secret into scheduler_secret from vault.decrypted_secrets
 where name='studio_publication_scheduler_secret' limit 1;
 if coalesce(length(scheduler_secret),0)<32 then return null; end if;
 select net.http_post(
   url:='https://admin.torrescotechnology.com/api/website/reconcile',
   headers:=jsonb_build_object('Content-Type','application/json','x-torres-studio-secret',scheduler_secret),
   body:='{}'::jsonb,timeout_milliseconds:=60000
 ) into request_id;
 return request_id;
end $$;
revoke all on function public.invoke_studio_publication_scheduler() from public,anon,authenticated;
do $$ begin
 if not exists(select 1 from cron.job where jobname='torres-studio-publications') then
  perform cron.schedule('torres-studio-publications','*/2 * * * *',
   'select public.invoke_studio_publication_scheduler();');
 end if;
end $$;
commit;
