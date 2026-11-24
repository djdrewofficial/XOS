-- Couple-app push notifications + in-app popups / custom screens.
-- Migration number: 00242 (PR #95 took 00240; PR #96 playlist moments takes 00241).
--
-- Staff author templates (schedule / status-change / helper action) with merge
-- tags and a tap target. Delivery queues into app_notification_log, drains via
-- Expo push from the existing send-outbox cron. Custom screens can embed
-- staff-authored HTML (per-DJ HighLevel booking widgets) served only through
-- authenticated couple-app APIs — never raw into XOS web pages.

-- ───────────────────────── per-DJ booking fields ───────────────────────────

alter table employees
  add column if not exists booking_embed_html text,
  add column if not exists booking_url text;

alter table company_settings
  add column if not exists default_booking_embed_html text,
  add column if not exists default_booking_url text;

comment on column employees.booking_embed_html is
  'Staff-authored HTML/iframe/script embed for this DJ''s planning-meeting widget. Couple app only (sandboxed WebView).';
comment on column employees.booking_url is
  'Public booking/calendar URL for this DJ. Falls back to planning_meeting_url when null.';
comment on column company_settings.default_booking_embed_html is
  'Company fallback embed when an event has no assigned DJ (or the DJ has no embed).';
comment on column company_settings.default_booking_url is
  'Company fallback booking URL when an event has no assigned DJ.';

-- ───────────────────────── custom in-app screens ───────────────────────────

create table if not exists app_notification_screens (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  heading           text not null default '',
  body_html         text not null default '',
  buttons           jsonb not null default '[]'::jsonb,
  -- none | dj_booking_embed | custom_html
  embed_source      text not null default 'none'
    check (embed_source in ('none', 'dj_booking_embed', 'custom_html')),
  custom_embed_html text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ───────────────────────── notification templates ──────────────────────────

create table if not exists app_notification_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  title               text not null default '',
  body                text not null default '',
  is_active           boolean not null default false,
  -- hosts | hosts_and_guests | guests
  audience            text not null default 'hosts'
    check (audience in ('hosts', 'hosts_and_guests', 'guests')),
  -- schedule | status_change | helper (helper = available as helper action only)
  trigger_type        text not null default 'schedule'
    check (trigger_type in ('schedule', 'status_change', 'helper')),
  schedule_days       int,
  schedule_direction  text check (schedule_direction is null or schedule_direction in ('before', 'after')),
  schedule_anchor     text not null default 'event_date',
  schedule_send_time  time not null default '09:00',
  -- When trigger_type = status_change: fire when event moves into one of these.
  status_ids          uuid[] not null default '{}',
  -- Optional filter for schedule trigger (empty = any status).
  sched_status_ids    uuid[] not null default '{}',
  -- tap: tab | screen | none
  tap_action          text not null default 'none'
    check (tap_action in ('tab', 'screen', 'none')),
  tap_tab             text,
  tap_screen_id       uuid references app_notification_screens(id) on delete set null,
  show_as_popup       boolean not null default true,
  send_push           boolean not null default true,
  -- Demo-mode events skip real sends unless this is true.
  allow_demo_mode     boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists app_notif_tpl_active_idx
  on app_notification_templates(is_active) where is_active;

-- ───────────────────────── schedule / status dedupe ────────────────────────

create table if not exists app_notification_runs (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references app_notification_templates(id) on delete cascade,
  event_id      uuid not null references events(id) on delete cascade,
  -- For schedule: the calendar target day (YYYY-MM-DD). For status_change: the status uuid text.
  trigger_key   text not null,
  status        text not null default 'sent'
    check (status in ('sent', 'skipped', 'marked_sent', 'pending')),
  created_at    timestamptz not null default now(),
  unique (template_id, event_id, trigger_key)
);

create index if not exists app_notif_runs_event_idx on app_notification_runs(event_id);

-- ───────────────────────── per-recipient outbox / log ──────────────────────

create table if not exists app_notification_log (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid references app_notification_templates(id) on delete set null,
  screen_id       uuid references app_notification_screens(id) on delete set null,
  event_id        uuid not null references events(id) on delete cascade,
  auth_user_id    uuid not null,
  audience_role   text not null default 'host'
    check (audience_role in ('host', 'guest')),
  title           text not null,
  body            text not null default '',
  tap_action      text not null default 'none'
    check (tap_action in ('tab', 'screen', 'none')),
  tap_tab         text,
  deep_link       text not null,
  show_as_popup   boolean not null default true,
  send_push       boolean not null default true,
  -- queued → sent | failed; opened / dismissed are terminal UX states after delivery
  status          text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'opened', 'dismissed', 'cancelled')),
  expo_ticket_id  text,
  error_message   text,
  queued_at       timestamptz not null default now(),
  sent_at         timestamptz,
  opened_at       timestamptz,
  dismissed_at    timestamptz,
  -- Dedupe one scheduled send per (template, event, user). Helper/manual may omit template.
  dedupe_key      text
);

create unique index if not exists app_notif_log_dedupe_uidx
  on app_notification_log(dedupe_key) where dedupe_key is not null;

create index if not exists app_notif_log_queued_idx
  on app_notification_log(status, queued_at) where status = 'queued';

create index if not exists app_notif_log_event_idx on app_notification_log(event_id);
create index if not exists app_notif_log_user_pending_idx
  on app_notification_log(auth_user_id, event_id, status)
  where status in ('queued', 'sent', 'opened');

-- ───────────────────────── couple-app device tokens ────────────────────────
-- Staff tokens stay in device_tokens. Couple app registers here so we never
-- mix staff push targeting with host/guest devices.

create table if not exists app_device_tokens (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null,
  expo_push_token text not null unique,
  platform        text,
  device_name     text,
  is_active       boolean not null default true,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists app_device_tokens_user_idx
  on app_device_tokens(auth_user_id) where is_active;

-- ───────────────────────── client prefs (optional) ─────────────────────────

create table if not exists app_notification_prefs (
  auth_user_id    uuid primary key,
  push_enabled    boolean not null default true,
  popup_enabled   boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- ───────────────────────── RLS ─────────────────────────────────────────────

alter table app_notification_screens   enable row level security;
alter table app_notification_templates enable row level security;
alter table app_notification_runs      enable row level security;
alter table app_notification_log       enable row level security;
alter table app_device_tokens          enable row level security;
alter table app_notification_prefs     enable row level security;

do $$ begin
  create policy "staff manage app notif screens" on app_notification_screens
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff manage app notif templates" on app_notification_templates
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff read app notif runs" on app_notification_runs
    for select to authenticated using (xos_is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff manage app notif runs" on app_notification_runs
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff read app notif log" on app_notification_log
    for select to authenticated using (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Couple users manage only their own tokens / prefs. Log rows are written by
-- the service role (API routes); hosts/guests read via authenticated API that
-- uses the admin client after membership checks — no direct client SELECT on log.

do $$ begin
  create policy "own app device tokens" on app_device_tokens
    for all to authenticated
    using (auth_user_id = (select auth.uid()))
    with check (auth_user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "own app notif prefs" on app_notification_prefs
    for all to authenticated
    using (auth_user_id = (select auth.uid()))
    with check (auth_user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;

-- ───────────────────────── merge-tag catalog entries ───────────────────────
-- <dj_booking_embed> is catalogued for the couple-app screen editor only.
-- It is NOT patched into render_merge_tags — raw embed HTML must never land
-- in email/SMS. TS resolves it when serving /api/mobile/app-notifications/screens.

insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values
  ('dj_name', 'Assigned DJ name', 'Staff',
   'Stage name (or first name) of the event''s primary DJ. Falls back to company name.',
   'builtin', null, true, true),
  ('dj_booking_url', 'DJ booking URL', 'Staff',
   'Assigned DJ booking_url, else planning_meeting_url, else company default_booking_url.',
   'builtin', null, true, true),
  ('dj_booking_embed', 'DJ booking embed (app screens only)', 'Staff',
   'Assigned DJ booking_embed_html (or company default). Couple-app custom screens only — never email.',
   'builtin', null, true, true)
on conflict (tag_key) do update
  set label = excluded.label, group_name = excluded.group_name, description = excluded.description,
      source_type = 'builtin', is_builtin = true, is_active = true;

-- Resolve <dj_name> and <dj_booking_url> inside render_merge_tags (safe text/URLs).
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));$a$;
  addition text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));
  if position('<dj_name>' in out_text) > 0 then
    out_text := replace(out_text, '<dj_name>', xos_html_escape(coalesce((
      select coalesce(nullif(em.stage_name, ''), nullif(trim(em.first_name || ' ' || coalesce(em.last_name, '')), ''), em.first_name)
      from event_staff es join employees em on em.id = es.employee_id
      where es.event_id = e.id
      order by (es.role ilike '%dj%') desc, em.stage_name nulls last, em.first_name
      limit 1
    ), (select coalesce(company_name, '') from company_settings where id is true limit 1))));
  end if;
  if position('<dj_booking_url>' in out_text) > 0 then
    out_text := replace(out_text, '<dj_booking_url>', xos_html_escape(coalesce((
      select coalesce(nullif(em.booking_url, ''), nullif(em.planning_meeting_url, ''))
      from event_staff es join employees em on em.id = es.employee_id
      where es.event_id = e.id
      order by (es.role ilike '%dj%') desc, em.stage_name nulls last, em.first_name
      limit 1
    ), (select coalesce(default_booking_url, '') from company_settings where id is true limit 1))));
  end if;$a$;
begin
  if position('<dj_name>' in src) > 0 then return; end if;
  if strpos(src, anchor) = 0 then raise exception 'render_merge_tags: <current_date> anchor not found'; end if;
  execute replace(src, anchor, addition);
end $mig$;
