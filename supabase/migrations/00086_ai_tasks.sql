-- Manage the daily AI tasks (morning briefing, vendor matcher, …) from
-- Settings → AI Assistant: enable/disable, recipients, and send hour. A single
-- hourly dispatcher (/api/cron/ai-tasks) reads this and runs what's due.

create table if not exists ai_tasks (
  key         text primary key,           -- 'morning_briefing' | 'vendor_matching'
  label       text not null,
  description text,
  enabled     boolean not null default true,
  config      jsonb not null default '{}'::jsonb,  -- { recipients, hour }
  last_run_on date,                        -- last run date in company timezone (dedupe)
  updated_at  timestamptz not null default now()
);

alter table ai_tasks enable row level security;
do $$ begin
  create policy "staff manage ai tasks" on ai_tasks
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

insert into ai_tasks (key, label, description, enabled, config) values
  ('morning_briefing', 'Morning Briefing',
   'A daily email digest of upcoming events, payments due, and unsigned agreements.',
   true, '{"recipients":"events@xpressdjs.com","hour":7}'::jsonb),
  ('vendor_matching', 'Vendor Matcher',
   'Matches vendors couples add against your directory (misspellings, missing info, duplicates) into the review queue.',
   true, '{"hour":7}'::jsonb)
on conflict (key) do nothing;
