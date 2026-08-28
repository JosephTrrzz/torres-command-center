-- Torres OS Phase 4: provider-backed transactional email delivery history.
-- Additive and idempotent. Apply after communications.sql.

begin;

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid references public.clients(id) on delete cascade,
  message_id uuid unique references public.messages(id) on delete set null,
  template_key text not null default '',
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array'),
  subject text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'delivery_delayed', 'failed', 'bounced', 'complained', 'suppressed')),
  provider text not null default 'resend' check (provider in ('resend')),
  provider_message_id text unique,
  idempotency_key text not null unique,
  error_detail text not null default '',
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_deliveries_client_status_idx on public.email_deliveries (client_id, status, created_at desc);
create index if not exists email_deliveries_provider_message_idx on public.email_deliveries (provider_message_id) where provider_message_id is not null;

create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.email_deliveries(id) on delete cascade,
  provider_event_id text not null unique,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_delivery_events_delivery_idx on public.email_delivery_events (delivery_id, occurred_at desc);

alter table public.email_deliveries enable row level security;
alter table public.email_delivery_events enable row level security;

drop policy if exists "email_deliveries_staff_read" on public.email_deliveries;
create policy "email_deliveries_staff_read" on public.email_deliveries for select to authenticated
using (
  public.can_access_organization(organization_id)
  and not public.has_organization_role(organization_id, array['client'])
);

drop policy if exists "email_delivery_events_staff_read" on public.email_delivery_events;
create policy "email_delivery_events_staff_read" on public.email_delivery_events for select to authenticated
using (exists (
  select 1 from public.email_deliveries delivery
  where delivery.id = delivery_id
    and public.can_access_organization(delivery.organization_id)
    and not public.has_organization_role(delivery.organization_id, array['client'])
));

revoke all on public.email_deliveries, public.email_delivery_events from anon;
revoke all on public.email_deliveries, public.email_delivery_events from authenticated;
grant select on public.email_deliveries, public.email_delivery_events to authenticated;

comment on table public.email_deliveries is 'Server-owned transactional email attempts with provider-confirmed lifecycle state. A row is never marked sent until the provider returns a message ID.';
comment on table public.email_delivery_events is 'Deduplicated, signed provider webhook events for transactional email delivery, bounce, complaint, and suppression history.';
comment on column public.email_deliveries.idempotency_key is 'Stable server-generated key that prevents duplicate provider sends when a request is retried.';
comment on column public.email_delivery_events.provider_event_id is 'Unique Svix/Resend webhook event ID used for at-least-once delivery deduplication.';

commit;
