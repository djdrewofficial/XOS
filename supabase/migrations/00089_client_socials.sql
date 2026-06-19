-- Social handles on the client profile (stored as bare @handle).
alter table clients add column if not exists instagram text;
alter table clients add column if not exists tiktok text;
