-- Playlist moments: staff mark planner sections as multi-song playlists
-- (Prelude, Cocktail Hour, Dinner, Open Dancing, etc.). Couples manage each
-- playlist's ordered song list in the app Music tab.
--
-- Reuses planning_songs (already section-scoped with sort_order, title, artist,
-- external_url, note, requested_by, is_demo). No new song table.
--
-- Numbered 00241 because open PR 95 adds 00240_demo_mode_helper_actions.sql.

alter table public.planning_template_sections
  add column if not exists is_playlist boolean not null default false;

alter table public.planning_sections
  add column if not exists is_playlist boolean not null default false;

comment on column public.planning_template_sections.is_playlist is
  'When true, this moment is a playlist the couple manages on the Music tab (ordered song list). Cloned onto event sections.';
comment on column public.planning_sections.is_playlist is
  'When true, this moment is a playlist on the couple app Music tab. Copied from the template; staff can override per event.';

create index if not exists planning_sections_event_playlist_idx
  on public.planning_sections (event_id)
  where is_playlist and deleted_by_host_at is null;

-- Safe backfill: only the Wedding 2026 catalog template, exact playlist-moment
-- titles (prelude / cocktail / dinner / open dancing). Does not mark Must Play,
-- Don't Play, Slow Dance, or single-song timeline moments.
update public.planning_template_sections
set is_playlist = true
where template_id = 'a1c50a27-3fd5-4f4f-95b2-b7ee2d1e7dd7'
  and title in (
    'Ceremony Prelude (Guest Arrival)',
    'Cocktail Vibes',
    'Dinner Music',
    'Dance Floor Suggestions'
  );

-- Propagate to event sections cloned from those template rows.
update public.planning_sections ps
set is_playlist = true
from public.planning_template_sections pts
where ps.template_section_id = pts.id
  and pts.is_playlist = true
  and ps.is_playlist = false;
