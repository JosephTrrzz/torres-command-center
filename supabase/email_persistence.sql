-- Keep the application profile email synchronized with Supabase Auth.
-- This migration does not change business contact, portal, billing, or client-person emails.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles
  set email = lower(coalesce(new.email, '')),
      updated_at = now()
  where id = new.id
    and email is distinct from lower(coalesce(new.email, ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute procedure public.sync_profile_email_from_auth();

update public.profiles as profile
set email = lower(coalesce(auth_user.email, '')),
    updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.email is distinct from lower(coalesce(auth_user.email, ''));

comment on function public.sync_profile_email_from_auth() is
  'Synchronizes profiles.email after a confirmed Supabase Auth login-email change. It does not alter business contact emails.';

revoke all on function public.handle_new_user() from public;
revoke all on function public.sync_profile_email_from_auth() from public;

commit;
