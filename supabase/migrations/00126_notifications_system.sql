-- XOS — Notification System (unified control center).
-- One place to control which notifications fire, to whom, and over which channels
-- (in-app bell · mobile push · email · SMS). Replaces the ad-hoc, company-global
-- notif_types allowlist (migration 00032) with a real catalog + per-role/-audience
-- channel matrix, adds push-token storage, and makes the bell per-recipient.
--
-- Model:
--   notification_types     — the catalog (one row per kind of notification).
--   notification_settings  — per (type, audience) channel toggles. "Audience" is a
--                            role (master_admin/admin/salesperson/employee) OR an
--                            event-relationship (event_salesperson/event_assigned_staff)
--                            OR client. A type's recipients = its enabled audiences.
--   device_tokens          — Expo push tokens registered by the staff mobile app.
--   notifications.target_*  — per-recipient targeting for the bell.
--
-- Company-global config with per-role defaults (no per-person prefs yet). Push
-- defaults ON for every type per product decision. Client-facing rows ship with
-- email/SMS OFF so they never double-send against existing automations/templates.

-- ───────────────────────── auth → employee helpers ─────────────────────────

-- The signed-in user's employee row id (null for the owner/unlinked login).
create or replace function xos_current_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from employees where auth_user_id = auth.uid() limit 1;
$$;

-- The signed-in user's permission tier. Owner/unlinked staff → 'master_admin'.
create or replace function xos_current_tier()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select permission_tier from employees where auth_user_id = auth.uid() limit 1),
    case when xos_is_staff() then 'master_admin' else null end
  );
$$;

-- Keep these callable only by signed-in users (RLS uses them internally).
revoke execute on function xos_current_employee_id() from anon, public;
revoke execute on function xos_current_tier() from anon, public;
grant execute on function xos_current_employee_id() to authenticated;
grant execute on function xos_current_tier() to authenticated;

-- ───────────────────────── notification_types (catalog) ────────────────────

create table if not exists notification_types (
  key               text primary key,
  label             text not null,
  category          text not null,                 -- events | money | staff | comms
  description       text,
  is_client_facing  boolean not null default false,
  -- staff-alert copy (merge-tag templates rendered by render_merge_tags)
  staff_title_tpl   text,
  staff_body_tpl    text,
  href_tpl          text,                           -- e.g. '/events/<event_id>'
  -- client-facing content reuses the existing template table
  email_template_id uuid references email_templates(id) on delete set null,
  sms_template_id   uuid references email_templates(id) on delete set null,
  sort_order        int not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Per (type, audience) channel matrix. A row existing + is_enabled means that
-- audience receives this type; the four booleans pick channels.
create table if not exists notification_settings (
  id          uuid primary key default gen_random_uuid(),
  type_key    text not null references notification_types(key) on delete cascade,
  audience    text not null,   -- master_admin|admin|salesperson|employee|event_salesperson|event_assigned_staff|client
  is_enabled  boolean not null default true,
  in_app      boolean not null default true,
  push        boolean not null default true,   -- push defaults ON per product decision
  email       boolean not null default false,
  sms         boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (type_key, audience)
);
create index if not exists notif_settings_type_idx on notification_settings(type_key);

-- ───────────────────────── device_tokens (push) ────────────────────────────

create table if not exists device_tokens (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null,                    -- from the mobile Supabase session
  employee_id     uuid references employees(id) on delete cascade,
  expo_push_token text not null unique,
  platform        text,                             -- ios | android
  device_name     text,
  is_active       boolean not null default true,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists device_tokens_emp_idx on device_tokens(employee_id) where is_active;

-- ───────────────────────── notifications targeting ─────────────────────────

alter table notifications add column if not exists target_employee_id uuid references employees(id) on delete cascade;
alter table notifications add column if not exists target_roles text[] not null default '{}';
create index if not exists notifications_target_emp_idx on notifications(target_employee_id) where read_at is null;

-- ───────────────────────── RLS ─────────────────────────────────────────────

alter table notification_types    enable row level security;
alter table notification_settings enable row level security;
alter table device_tokens         enable row level security;

do $$ begin
  create policy "staff manage notification types" on notification_types
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff manage notification settings" on notification_settings
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- A user manages only their own device tokens (mobile app registers/removes).
do $$ begin
  create policy "own device tokens" on device_tokens
    for all to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ───────────────────────── seed the catalog ────────────────────────────────
-- Helper-free seed: insert each type, then its audience→channel rows. Audiences
-- listed get in_app+push by default (email/sms only where flagged). Idempotent.

do $seed$
begin
  -- EVENTS ------------------------------------------------------------------
  insert into notification_types (key, label, category, description, staff_title_tpl, staff_body_tpl, href_tpl, sort_order) values
    ('agreement_signed',      'Booking Agreement signed', 'events', 'A client signed their Booking Agreement.',
       'Booking Agreement signed', '<event_name> · <client_full_name>', '/events/<event_id>', 10),
    ('event_created',         'New event / inquiry',      'events', 'A new event or inquiry was created.',
       'New event created', '<event_name>', '/events/<event_id>', 11),
    ('proposal_confirmed',    'Proposal accepted',        'events', 'A client accepted their proposal.',
       'Proposal accepted', '<event_name> · <client_full_name>', '/events/<event_id>', 12),
    ('event_status_changed',  'Event status changed',     'events', 'An event moved to a new status.',
       'Status changed', '<event_name>', '/events/<event_id>', 13),
    ('event_datetime_changed','Event date/time changed',  'events', 'An event date or time was edited.',
       'Event date/time changed', '<event_name> · <event_date_long>', '/events/<event_id>', 14),
    ('planner_updated',       'Client updated the planner','events','A client edited planning or submitted music.',
       'Planner updated', '<event_name> · <client_full_name>', '/events/<event_id>', 15)
  on conflict (key) do nothing;

  -- MONEY -------------------------------------------------------------------
  insert into notification_types (key, label, category, description, staff_title_tpl, staff_body_tpl, href_tpl, sort_order) values
    ('payment_received',      'Payment received',         'money',  'A payment was recorded.',
       'Payment received', '<event_name>', '/events/<event_id>', 20),
    ('zelle_pending',         'Zelle claim needs confirming','money','A client submitted a Zelle payment claim.',
       'Zelle claim to confirm', '<event_name>', '/events/<event_id>', 21),
    ('unassigned_payment',    'Unassigned payment',       'money',  'A payment arrived not linked to an event.',
       'Unassigned payment', 'Assign it to an event.', '/payments', 22),
    ('email_bounced',         'Email bounced / failed',   'money',  'An outbound email bounced or was complained.',
       'Email delivery issue', null, '/settings/email', 23)
  on conflict (key) do nothing;

  -- STAFF -------------------------------------------------------------------
  insert into notification_types (key, label, category, description, staff_title_tpl, staff_body_tpl, href_tpl, sort_order) values
    ('staff_assigned',        'Assigned to an event',     'staff',  'A staff member was assigned to an event.',
       'You were assigned to an event', '<event_name> · <event_date_long>', '/events/<event_id>', 30),
    ('staff_confirmed',       'Gig confirmed',            'staff',  'A staff member confirmed a gig.',
       'Gig confirmed', '<event_name>', '/events/<event_id>', 31),
    ('staff_declined',        'Gig declined',             'staff',  'A staff member declined a gig.',
       'Gig declined', '<event_name>', '/events/<event_id>', 32),
    ('checkin_reminder',      'Check-in reminder (day-of)','staff', 'Day-of reminder to check in to an event.',
       'Time to check in', '<event_name> · <event_date_long>', '/events/<event_id>', 33),
    ('missed_checkin',        'Missed check-in',          'staff',  'A staff member did not check in on time.',
       'Missed check-in', '<event_name>', '/events/<event_id>', 34),
    ('timesheet_submitted',   'Timesheet / change request','staff', 'A staff member submitted a timesheet change.',
       'Timesheet change request', null, '/payroll', 35),
    ('time_off_request',      'Time off request',         'staff',  'A staff member requested time off.',
       'Time off request', null, '/employees', 36)
  on conflict (key) do nothing;

  -- COMMS -------------------------------------------------------------------
  insert into notification_types (key, label, category, description, staff_title_tpl, staff_body_tpl, href_tpl, sort_order) values
    ('inbound_message',       'New message from a client','comms',  'A client replied by SMS or email.',
       'New message', '<client_full_name>', '/inbox', 40)
  on conflict (key) do nothing;

  insert into notification_types (key, label, category, description, is_client_facing, sort_order) values
    ('review_request',        'Post-event review request','comms',  'Ask the client for a review after the event.', true, 41)
  on conflict (key) do nothing;

  -- audiences per type (role + event-relationship). in_app+push on by default.
  -- email/sms flagged explicitly where sensible. Client-facing rows ship OFF.
  insert into notification_settings (type_key, audience, is_enabled, in_app, push, email, sms) values
    -- events
    ('agreement_signed','event_salesperson',true,true,true,true,false),
    ('agreement_signed','master_admin',     true,true,true,false,false),
    ('agreement_signed','admin',            true,true,true,false,false),
    ('event_created','salesperson',         true,true,true,false,false),
    ('event_created','master_admin',        true,true,true,false,false),
    ('event_created','admin',               true,true,true,false,false),
    ('proposal_confirmed','event_salesperson',true,true,true,false,false),
    ('proposal_confirmed','master_admin',   true,true,true,false,false),
    ('proposal_confirmed','admin',          true,true,true,false,false),
    ('event_status_changed','event_salesperson',true,true,true,false,false),
    ('event_datetime_changed','event_assigned_staff',true,true,true,false,false),
    ('event_datetime_changed','event_salesperson',true,true,true,false,false),
    ('planner_updated','event_salesperson', true,true,true,false,false),
    -- money
    ('payment_received','master_admin',     true,true,true,false,false),
    ('payment_received','admin',            true,true,true,false,false),
    ('zelle_pending','master_admin',        true,true,true,false,false),
    ('zelle_pending','admin',               true,true,true,false,false),
    ('unassigned_payment','master_admin',   true,true,true,false,false),
    ('unassigned_payment','admin',          true,true,true,false,false),
    ('email_bounced','master_admin',        true,true,true,false,false),
    ('email_bounced','admin',               true,true,true,false,false),
    -- staff
    ('staff_assigned','event_assigned_staff',true,true,true,false,false),
    ('staff_confirmed','event_salesperson', true,true,true,false,false),
    ('staff_confirmed','admin',             true,true,true,false,false),
    ('staff_declined','event_salesperson',  true,true,true,false,false),
    ('staff_declined','master_admin',       true,true,true,false,false),
    ('staff_declined','admin',              true,true,true,false,false),
    ('checkin_reminder','event_assigned_staff',true,true,true,false,false),
    ('missed_checkin','master_admin',       true,true,true,false,false),
    ('missed_checkin','admin',              true,true,true,false,false),
    ('timesheet_submitted','master_admin',  true,true,true,false,false),
    ('timesheet_submitted','admin',         true,true,true,false,false),
    ('time_off_request','master_admin',     true,true,true,false,false),
    ('time_off_request','admin',            true,true,true,false,false),
    -- comms
    ('inbound_message','event_salesperson', true,true,true,false,false),
    ('inbound_message','admin',             true,true,true,false,false),
    -- client-facing: present but OFF so it never double-sends vs automations
    ('review_request','client',             false,false,false,false,false)
  on conflict (type_key, audience) do nothing;
end $seed$;
