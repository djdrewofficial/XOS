-- XOS — Planner section settings, must-play, soft-delete, audit log, and the
-- seed-race fix. Mirrors Vibo's "Section settings" modal.

-- ── Seed-race fix ──────────────────────────────────────────────────────────
-- Every planner page load called ensureEventPlanning(); with no atomic claim,
-- concurrent first-loads each seeded a full template (the 18× duplication).
-- A claim flag on the event makes seeding win-once.
alter table events add column if not exists planning_seeded boolean not null default false;

-- One-time cleanup: wipe the duplicated test sections so they re-seed cleanly
-- (everything was 0% — no real answers/songs to lose). Cascades to questions/
-- answers/songs/likes. planning_seeded stays false → re-seeds once on next open.
delete from planning_sections;

-- ── Section type: add 'headline' (a titled divider with no content) ──────────
alter table planning_sections          drop constraint if exists planning_sections_section_type_check;
alter table planning_sections          add  constraint planning_sections_section_type_check
  check (section_type in ('info', 'timeline', 'headline'));
alter table planning_template_sections drop constraint if exists planning_template_sections_section_type_check;
alter table planning_template_sections add  constraint planning_template_sections_section_type_check
  check (section_type in ('info', 'timeline', 'headline'));

-- ── Per-section settings (mirror onto template sections too) ─────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['planning_sections', 'planning_template_sections'] loop
    execute format('alter table %I add column if not exists songs_enabled boolean not null default true', tbl);
    execute format('alter table %I add column if not exists questions_enabled boolean not null default true', tbl);
    execute format('alter table %I add column if not exists notes_enabled boolean not null default true', tbl);
    execute format('alter table %I add column if not exists time_enabled boolean not null default false', tbl);
    execute format('alter table %I add column if not exists must_play_limit int', tbl);
    execute format('alter table %I add column if not exists section_cover_url text', tbl);
    -- permissions: jsonb of action -> array of roles ("dj","host"). Missing key
    -- means the app default (dj + host). Guest visibility uses guest_enabled.
    execute format('alter table %I add column if not exists permissions jsonb not null default ''{}''::jsonb', tbl);
  end loop;
end $$;

-- Host soft-delete: hidden from the host, still shown to staff under
-- "Host Deleted Sections". Null = live.
alter table planning_sections add column if not exists deleted_by_host_at timestamptz;
alter table planning_sections add column if not exists deleted_by_host uuid references auth.users(id) on delete set null;

-- ── Must-play on songs ──────────────────────────────────────────────────────
alter table planning_songs add column if not exists must_play boolean not null default false;

-- ── Audit log (staff-only visibility) ───────────────────────────────────────
create table if not exists planning_audit_log (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name    text,
  actor_role    text,        -- staff | host | guest
  action        text not null,
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists pal_event_idx on planning_audit_log(event_id, created_at desc);

-- Questions-only "info" sections shouldn't show a song picker.
update planning_template_sections set songs_enabled = false where section_type = 'info';

alter table planning_audit_log enable row level security;
-- Anyone on the event can WRITE their own action; only staff can READ the log.
do $$ begin
  create policy "log write" on planning_audit_log
    for insert to authenticated with check (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read log" on planning_audit_log
    for select to authenticated using (xos_is_staff());
exception when duplicate_object then null; end $$;
