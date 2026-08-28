-- Secure Formspree-to-CRM lead provenance and retry deduplication.
-- Additive only: existing CRM leads are unchanged and no example data is inserted.

begin;

alter table public.crm_leads
  add column if not exists external_provider text,
  add column if not exists external_submission_id text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_leads_external_submission_unique'
      and conrelid = 'public.crm_leads'::regclass
  ) then
    alter table public.crm_leads
      add constraint crm_leads_external_submission_unique
      unique (external_provider, external_submission_id);
  end if;
end $$;

alter table public.crm_leads
  drop constraint if exists crm_leads_external_submission_pair;

alter table public.crm_leads
  add constraint crm_leads_external_submission_pair check (
    (external_provider is null and external_submission_id is null)
    or (
      length(trim(external_provider)) > 0
      and length(trim(external_submission_id)) > 0
    )
  );

comment on column public.crm_leads.external_provider is 'Server-verified provider that originated this lead, such as Formspree.';
comment on column public.crm_leads.external_submission_id is 'Non-secret provider event ID or stable server fingerprint used to deduplicate webhook retries.';
comment on column public.crm_leads.source_metadata is 'Whitelisted, non-secret lead provenance such as form ID, submission time, contact preference, and source URL.';

commit;
