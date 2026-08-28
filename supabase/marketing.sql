-- Torres OS Phase 4B: client-scoped campaigns, review requests, recipients, and suppressions.
-- Additive and idempotent. Apply after communications.sql and transactional_email.sql.

begin;

insert into public.permissions (key, name, description) values
  ('marketing.read', 'Read marketing', 'View client-scoped campaigns, review requests, recipients, and delivery state.'),
  ('marketing.manage', 'Manage marketing', 'Create, test, approve, and send client-scoped campaigns and review requests.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.role_permissions (role, permission_key)
select role_name, permission_key
from (values
  ('owner', 'marketing.read'), ('owner', 'marketing.manage'),
  ('admin', 'marketing.read'), ('admin', 'marketing.manage'),
  ('operator', 'marketing.read'), ('operator', 'marketing.manage'),
  ('member', 'marketing.read'),
  ('viewer', 'marketing.read')
) as role_map(role_name, permission_key)
on conflict do nothing;

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_job_id uuid references public.service_jobs(id) on delete set null,
  campaign_type text not null default 'announcement' check (campaign_type in ('announcement', 'newsletter', 'review_request')),
  name text not null check (length(trim(name)) > 0),
  subject text not null check (length(trim(subject)) > 0),
  preview_text text not null default '',
  body text not null check (length(trim(body)) > 0),
  review_url text,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'partial', 'canceled')),
  created_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_url is null or review_url ~ '^https?://'),
  check (campaign_type <> 'review_request' or review_url is not null)
);

create index if not exists marketing_campaigns_client_status_idx
on public.marketing_campaigns (client_id, status, updated_at desc);

create table if not exists public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  client_person_id uuid references public.client_people(id) on delete set null,
  email_delivery_id uuid references public.email_deliveries(id) on delete set null,
  email text not null check (position('@' in email) > 1),
  display_name text not null default '',
  consent_basis text not null check (consent_basis in ('business_relationship', 'explicit_opt_in')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'delivered', 'delivery_delayed', 'failed', 'bounced', 'complained', 'suppressed')),
  provider_message_id text,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  error_detail text not null default '',
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists marketing_campaign_recipients_campaign_status_idx
on public.marketing_campaign_recipients (campaign_id, status, created_at);
create index if not exists marketing_campaign_recipients_provider_idx
on public.marketing_campaign_recipients (provider_message_id) where provider_message_id is not null;

create table if not exists public.marketing_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'provider_suppressed', 'manual')),
  source text not null default 'application' check (source in ('application', 'recipient_link', 'resend_webhook', 'admin')),
  detail text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketing_suppressions_organization_email_idx
on public.marketing_suppressions (organization_id, email);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_recipients enable row level security;
alter table public.marketing_suppressions enable row level security;

drop policy if exists "marketing_campaigns_staff_read" on public.marketing_campaigns;
create policy "marketing_campaigns_staff_read" on public.marketing_campaigns for select to authenticated
using (
  public.can_access_organization(organization_id)
  and not public.has_organization_role(organization_id, array['client'])
);

drop policy if exists "marketing_campaign_recipients_staff_read" on public.marketing_campaign_recipients;
create policy "marketing_campaign_recipients_staff_read" on public.marketing_campaign_recipients for select to authenticated
using (
  public.can_access_organization(organization_id)
  and not public.has_organization_role(organization_id, array['client'])
);

drop policy if exists "marketing_suppressions_staff_read" on public.marketing_suppressions;
create policy "marketing_suppressions_staff_read" on public.marketing_suppressions for select to authenticated
using (
  public.can_access_organization(organization_id)
  and not public.has_organization_role(organization_id, array['client'])
);

revoke all on public.marketing_campaigns, public.marketing_campaign_recipients, public.marketing_suppressions from anon;
revoke all on public.marketing_campaigns, public.marketing_campaign_recipients, public.marketing_suppressions from authenticated;
grant select on public.marketing_campaigns, public.marketing_campaign_recipients, public.marketing_suppressions to authenticated;

comment on table public.marketing_campaigns is 'Server-owned client-scoped email campaigns and post-service review requests. Drafts require an explicit staff send action.';
comment on table public.marketing_campaign_recipients is 'One personalized provider delivery per approved campaign recipient, including consent basis and unsubscribe token.';
comment on table public.marketing_suppressions is 'Organization-wide do-not-send registry populated by unsubscribe actions, provider bounces or complaints, and authorized staff.';
comment on column public.marketing_campaign_recipients.consent_basis is 'The staff-confirmed reason this recipient may receive the campaign; never inferred automatically from contact existence.';

commit;
