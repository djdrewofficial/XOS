-- XOS — Per-user Spotify connections so couples can log into THEIR Spotify and
-- import their own (private) playlists. Tokens are written/read by the
-- service-role client only; RLS is enabled with no policies so the anon/auth
-- API can never read raw tokens.
create table if not exists spotify_accounts (
  auth_user_id    uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text,
  display_name    text,
  access_token    text not null,
  refresh_token   text not null,
  expires_at      timestamptz not null,
  scope           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table spotify_accounts enable row level security;
