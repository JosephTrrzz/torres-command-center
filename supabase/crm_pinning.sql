-- Torres OS CRM pinning upgrade.
-- Safe to run more than once. Existing leads remain unpinned and no records are deleted.

begin;

alter table public.crm_leads
  add column if not exists is_pinned boolean not null default false;

alter table public.crm_leads
  add column if not exists pinned_at timestamptz;

create index if not exists crm_leads_client_pin_idx
  on public.crm_leads (client_id, is_pinned desc, pinned_at desc, created_at desc);

comment on column public.crm_leads.is_pinned is
  'Keeps an important lead at the top of its pipeline stage without changing its workflow status.';

comment on column public.crm_leads.pinned_at is
  'Records when a lead was pinned so recently pinned leads can be ordered first.';

commit;
