-- XOS — Vibo planning page config. The post-payment screen that explains Vibo,
-- gives device-aware download links + the join link, and lets the client invite
-- a partner/planner by text. The host/join link itself is stored per event in
-- events.custom_fields.vibo_link (set by the Zapier zap on contract signing).
alter table journey_settings add column if not exists vibo_intro text not null default
  'Your DJ planning happens in Vibo — build your timeline, song requests, and must-plays, all in one place. Download the app, then tap below to jump into your event.';
alter table journey_settings add column if not exists vibo_video_url text;   -- Vimeo player URL
alter table journey_settings add column if not exists vibo_ios_url text;      -- App Store
alter table journey_settings add column if not exists vibo_android_url text;  -- Google Play
alter table journey_settings add column if not exists vibo_web_url text;      -- web app
