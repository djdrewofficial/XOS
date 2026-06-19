-- Per-song "Do Not Play" flag for the planner (alongside must_play + note).
-- Couples can flag a specific track to avoid, without moving it to the
-- separate "Don't Play" section.
alter table planning_songs add column if not exists do_not_play boolean not null default false;
