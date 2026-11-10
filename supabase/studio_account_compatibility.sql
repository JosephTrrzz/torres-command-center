begin;
-- Existing client credentials and membership assignments remain unchanged.
-- This field is needed by the current auth reader; this migration enrolls nobody.
alter table public.profiles add column if not exists website_only boolean not null default false;
create or replace function public.protect_website_enrollment() returns trigger
language plpgsql as $$ begin
  if current_user in ('anon','authenticated') and new.website_only is distinct from old.website_only then
    raise exception 'Website access enrollment is staff managed';
  end if;
  return new;
end $$;
drop trigger if exists protect_website_enrollment on public.profiles;
create trigger protect_website_enrollment before update on public.profiles for each row execute function public.protect_website_enrollment();
comment on column public.profiles.website_only is 'Optional restricted account enrollment. Defaults false; requires the complete studio_client_review isolation migration before enabling. Existing clients use their current memberships.';
commit;
