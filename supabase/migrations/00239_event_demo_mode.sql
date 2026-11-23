-- Event Demo Mode: staff can seed a realistic Apple Review–style planner for a
-- prospect, then later turn it off so real planning starts clean.
-- Demo rows are marked is_demo so disable can remove sample data without
-- guessing. Does not touch hide_financials or comms_paused.

alter table public.events
  add column if not exists demo_mode boolean not null default false;
alter table public.events
  add column if not exists demo_mode_enabled_at timestamptz;

comment on column public.events.demo_mode is
  'When true, this event''s planner is filled with sample Demo Mode data for prospects. Turn off before real planning.';
comment on column public.events.demo_mode_enabled_at is
  'When Demo Mode was last enabled. Used to tell seeded answers from client edits during demo.';

alter table public.planning_sections
  add column if not exists is_demo boolean not null default false;
alter table public.planning_questions
  add column if not exists is_demo boolean not null default false;
alter table public.planning_question_answers
  add column if not exists is_demo boolean not null default false;
alter table public.planning_songs
  add column if not exists is_demo boolean not null default false;
alter table public.song_idea_lists
  add column if not exists is_demo boolean not null default false;
alter table public.song_ideas
  add column if not exists is_demo boolean not null default false;
alter table public.planning_do_not_play_notes
  add column if not exists is_demo boolean not null default false;

create index if not exists planning_sections_event_demo_idx
  on public.planning_sections (event_id) where is_demo;
create index if not exists planning_questions_event_demo_idx
  on public.planning_questions (event_id) where is_demo;
create index if not exists planning_songs_event_demo_idx
  on public.planning_songs (event_id) where is_demo;
create index if not exists song_ideas_event_demo_idx
  on public.song_ideas (event_id) where is_demo;

-- Field-staff view must carry demo_mode so DJs see the banner on assigned events.
drop view if exists public.xos_fs_events;
create view public.xos_fs_events with (security_invoker = false, security_barrier = true) as
select
  e.id, e.event_number, e.name, e.event_date, e.setup_time, e.start_time, e.end_time,
  e.guest_count, e.client_id, e.venue_id, e.venue_room_id, e.use_client_address,
  e.package_id, e.package_version_no, e.package_description_override,
  e.status_id, e.event_type_id, e.salesperson_id, e.inquiry_source_id,
  e.point_of_contact_employee_id, e.journey_type_id,
  e.internal_notes, e.custom_fields, e.planning_seeded, e.planning_template_id,
  e.overtime_hours, e.hide_financials, e.comms_paused, e.demo_mode, e.demo_mode_enabled_at,
  e.initial_contact_date, e.quote_sent_date, e.contract_sent_date, e.contract_due_date,
  e.contract_signed_date, e.booked_date,
  e.decision_maker_name, e.decision_maker_phone, e.decision_maker_email,
  e.cover_photo_url, e.cover_photo_updated_by, e.cover_photo_hidden_at, e.cover_photo_hidden_by,
  e.archived_at, e.created_at, e.updated_at
from public.events e
where public.xos_is_staff()
  and (public.xos_sees_all_events() or public.xos_is_assigned(e.id));

revoke all on public.xos_fs_events from public, anon, authenticated;
grant select on public.xos_fs_events to authenticated, service_role;
