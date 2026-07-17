-- Per-field planner history (staff-only).
--
-- planning_audit_log was a flat "who did what" feed: no link to the specific
-- question/section/song, and no record of the value that was replaced. That
-- made two things impossible: showing "last changed by X at Y" against each
-- field, and recovering something a host deleted or overwrote by mistake.
--
-- These columns carry the target + the before/after values so the planner can
-- render a per-field history and restore a previous value.

alter table planning_audit_log
  add column if not exists section_id   uuid,
  add column if not exists question_id  uuid,
  add column if not exists song_id      uuid,
  add column if not exists target_type  text,   -- answer | song | question | section | settings
  add column if not exists target_label text,   -- human label, snapshotted so it survives deletion
  add column if not exists old_value    text,   -- prior value, human-readable (display only)
  add column if not exists new_value    text,   -- new value, human-readable (display only)
  add column if not exists snapshot     jsonb;  -- machine payload for Restore; null = not restorable

-- old_value/new_value are for reading; `snapshot` is what Restore replays. Keeping
-- them separate avoids guessing whether a stored string is prose or JSON, and lets
-- a deleted row carry its full record without dumping JSON into the UI.
-- snapshot shape: { kind: 'answer' | 'song_row' | 'song_patch' | 'question_row'
--                        | 'section_tree' | 'section_patch', ... }

-- The planner only needs to know *whether* an entry can be restored; a deleted
-- section's snapshot carries its whole subtree, which we don't want to ship to
-- the browser just to decide if a button renders.
alter table planning_audit_log
  add column if not exists restorable boolean generated always as (snapshot is not null) stored;

-- NOTE: section_id/question_id/song_id are deliberately NOT foreign keys. The
-- whole point of this history is to survive the deletion of the row it refers
-- to — an FK (cascade or set null) would erase exactly the entries we need in
-- order to restore.

create index if not exists pal_question_idx
  on planning_audit_log(question_id, created_at desc) where question_id is not null;
create index if not exists pal_section_idx
  on planning_audit_log(section_id, created_at desc) where section_id is not null;
create index if not exists pal_song_idx
  on planning_audit_log(song_id, created_at desc) where song_id is not null;

-- Tighten the write policy. The old one let anyone on the event insert a row
-- claiming any actor_user_id, so a host could forge an entry attributed to
-- staff. Now that this log is trusted as the record of who changed what (and
-- drives restore), pin the actor to the caller.
drop policy if exists "log write" on planning_audit_log;
create policy "log write" on planning_audit_log
  for insert to authenticated
  with check (xos_can_access_event(event_id) and actor_user_id = auth.uid());

-- Reads stay staff-only ("staff read log" from 00075). No update/delete policy
-- exists, so the history is append-only for everyone but the service role.
