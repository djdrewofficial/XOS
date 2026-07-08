-- Facebook + YouTube profile URLs for the email editor's "Social" inserter
-- (instagram_url and tiktok_url already exist). Set in Settings → Email →
-- Social Links; used to build the self-hosted social icon row in emails.
alter table company_settings
  add column if not exists facebook_url text,
  add column if not exists youtube_url text;
