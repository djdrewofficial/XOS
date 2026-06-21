-- XOS — Spotify live-sync for planner song sections (+ selective import support).
--
-- A song section can be "live-synced" to one of the couple's Spotify playlists:
-- an hourly cron (/api/cron/spotify-sync) re-pulls the playlist and reconciles
-- the section's songs — adding new tracks and removing ones taken off the
-- playlist. Manually-added songs are left untouched (only `synced` rows are
-- managed by the sync).

alter table planning_sections
  add column if not exists spotify_sync_playlist_id   text,
  add column if not exists spotify_sync_playlist_name text,
  add column if not exists spotify_sync_user_id       uuid references auth.users(id) on delete set null,
  add column if not exists spotify_synced_at          timestamptz;

-- Songs added by the live sync are flagged so reconciliation only adds/removes
-- sync-managed rows and never disturbs songs the couple added by hand.
alter table planning_songs
  add column if not exists synced boolean not null default false;

create index if not exists ps_spotify_sync_idx
  on planning_sections(spotify_sync_playlist_id)
  where spotify_sync_playlist_id is not null;
