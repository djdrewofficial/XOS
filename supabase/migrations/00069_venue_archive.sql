-- XOS — venue archiving (hide from the directory without deleting). archived_at
-- null = active, matching the events pattern.
alter table venues add column if not exists archived_at timestamptz;
create index if not exists venues_active_idx on venues(name) where archived_at is null;
