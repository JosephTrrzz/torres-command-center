-- Torres & Co. Command Center: plain-language Supabase descriptions
--
-- Run this file in Supabase SQL Editor. It adds documentation only:
-- it does not insert, update, or delete rows and it does not change RLS.

comment on table public.clients is
  'One row per business/client managed in the Torres & Co. Command Center. This is the main business record.';
comment on column public.clients.id is
  'Stable unique ID for the client. Referenced by contacts, portal accounts, user profiles, and Google connections.';
comment on column public.clients.name is
  'Client business name shown throughout the Command Center.';
comment on column public.clients.industry is
  'Business category or industry used for display and reporting context.';
comment on column public.clients.location is
  'Primary business location or mailing address.';
comment on column public.clients.website is
  'Client public website URL, not the admin Command Center URL.';
comment on column public.clients.email is
  'Primary business contact email used for client communication and onboarding.';
comment on column public.clients.phone is
  'Primary business phone number.';
comment on column public.clients.health_score is
  'Current internal health score from 0 to 100. It controls the health indicator shown on client cards.';
comment on column public.clients.created_at is
  'Timestamp when the client record was created.';

comment on table public.client_people is
  'Optional contacts who work at a client business. This is separate from login users and does not create an account.';
comment on column public.client_people.id is
  'Stable unique ID for the contact.';
comment on column public.client_people.client_id is
  'The business this person belongs to. Do not use a different client ID.';
comment on column public.client_people.name is
  'Contact full name.';
comment on column public.client_people.role is
  'Contact job title or responsibility.';
comment on column public.client_people.email is
  'Contact email address.';
comment on column public.client_people.phone is
  'Contact phone number.';
comment on column public.client_people.notes is
  'Internal context about the contact. Do not store passwords, tokens, or other secrets.';
comment on column public.client_people.created_at is
  'Timestamp when the contact was added.';

comment on table public.profiles is
  'Application access record for authenticated people. Supabase Auth stores the login; this table stores the Command Center role and client assignment.';
comment on column public.profiles.id is
  'Matches the user ID in auth.users. Do not invent or manually replace this value.';
comment on column public.profiles.email is
  'Supabase Auth sign-in email synchronized from auth.users. This is separate from business, portal, billing, and contact email fields.';
comment on column public.profiles.full_name is
  'Name displayed for the signed-in user.';
comment on column public.profiles.role is
  'Access level: owner manages the workspace, employee helps manage it, customer sees the assigned client portal.';
comment on column public.profiles.client_id is
  'Client assigned to a customer user. Staff users may have this blank.';
comment on column public.profiles.active is
  'Whether this user is allowed to access the application.';
comment on column public.profiles.created_at is
  'Timestamp when the application profile was created.';
comment on column public.profiles.updated_at is
  'Timestamp when the application profile was last changed.';

comment on table public.customer_accounts is
  'Customer portal and billing state for a client. There is at most one row per client.';
comment on column public.customer_accounts.id is
  'Stable unique ID for the portal account record.';
comment on column public.customer_accounts.client_id is
  'The client whose portal is being configured.';
comment on column public.customer_accounts.portal_email is
  'Email the client uses to activate and sign in to the portal.';
comment on column public.customer_accounts.portal_enabled is
  'Whether the customer portal is allowed to open for this client.';
comment on column public.customer_accounts.portal_status is
  'Portal lifecycle: invited, active, paused, or revoked.';
comment on column public.customer_accounts.billing_email is
  'Email used for billing communication; it does not grant portal access.';
comment on column public.customer_accounts.billing_status is
  'Billing lifecycle: not_connected, pending, active, past_due, or canceled.';
comment on column public.customer_accounts.square_customer_id is
  'Square customer reference, when Square billing is connected. Not a secret.';
comment on column public.customer_accounts.square_subscription_id is
  'Square subscription reference, when a subscription exists.';
comment on column public.customer_accounts.created_at is
  'Timestamp when portal/billing settings were created.';
comment on column public.customer_accounts.updated_at is
  'Timestamp when portal/billing settings were last changed.';

comment on table public.google_connections is
  'Private Google OAuth connection for a client. The app uses this connection to retrieve approved Google data and map properties.';
comment on column public.google_connections.id is
  'Stable unique ID for the Google connection.';
comment on column public.google_connections.client_id is
  'The client whose Google account is connected. One connection is allowed per client.';
comment on column public.google_connections.google_email is
  'Google account that authorized the connection.';
comment on column public.google_connections.access_token is
  'Sensitive short-lived Google OAuth token. Never copy, publish, or edit manually.';
comment on column public.google_connections.refresh_token is
  'Sensitive token used to refresh Google access. Never copy, publish, or edit manually.';
comment on column public.google_connections.expires_at is
  'Time when the current access token expires.';
comment on column public.google_connections.scopes is
  'Google permissions granted by the user.';
comment on column public.google_connections.business_profile_location is
  'Selected Google Business Profile location for this client, when API access is approved.';
comment on column public.google_connections.search_console_site is
  'Selected Google Search Console site/property for this client.';
comment on column public.google_connections.analytics_property is
  'Selected GA4 property for this client.';
comment on column public.google_connections.created_at is
  'Timestamp when the Google connection was first saved.';
comment on column public.google_connections.updated_at is
  'Timestamp when the Google connection or mapped properties were last changed.';

comment on table public.notifications is
  'User-specific Command Center activity shown in the header notification bell. Each row is visible only to its assigned authenticated user.';
comment on column public.notifications.id is
  'Stable unique ID for the notification.';
comment on column public.notifications.user_id is
  'Authenticated user who can read and update this notification.';
comment on column public.notifications.client_id is
  'Optional client related to this activity.';
comment on column public.notifications.type is
  'Visual category: insight, action, report, or system.';
comment on column public.notifications.title is
  'Short notification heading.';
comment on column public.notifications.body is
  'Plain-language activity description. Do not store secrets or activation tokens here.';
comment on column public.notifications.href is
  'Optional internal Command Center path opened when the notification is selected.';
comment on column public.notifications.read_at is
  'Time the user marked the notification as read; blank means unread.';
comment on column public.notifications.created_at is
  'Timestamp when the notification was created.';
