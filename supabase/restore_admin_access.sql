-- Restore Torres & Co. admin access for jos.jt@icloud.com.
-- Run in Supabase SQL Editor while signed in as the project owner.
-- This changes only the matching application profile's access role.

insert into public.profiles (id, email, full_name, role, client_id, active, updated_at)
select
  id,
  lower(email),
  coalesce(raw_user_meta_data ->> 'full_name', 'Joseph Torres'),
  'owner',
  null,
  true,
  now()
from auth.users
where lower(email) = lower('jos.jt@icloud.com')
on conflict (id) do update
set email = excluded.email,
    full_name = case
      when public.profiles.full_name = '' then excluded.full_name
      else public.profiles.full_name
    end,
    role = 'owner',
    client_id = null,
    active = true,
    updated_at = now();

-- Verify the repair returned exactly the intended account.
select id, email, full_name, role, client_id, active
from public.profiles
where lower(email) = lower('jos.jt@icloud.com');
