alter table public.google_connections add column if not exists business_profile_location text;
alter table public.google_connections add column if not exists search_console_site text;
alter table public.google_connections add column if not exists analytics_property text;
