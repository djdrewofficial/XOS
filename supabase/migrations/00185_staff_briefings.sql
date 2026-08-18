-- Per-staff Daily Briefing + reliable scheduling.
--   * staff_briefing_prefs: who gets the personalized daily briefing and how often.
--   * a 'staff_briefings' ai_tasks row so it runs from the (now reliable) ai-tasks cron.
--   * move the Tasks engine to 5:30am so tasks exist BEFORE the 7am briefing that lists them.
--   * add pg_cron hourly → /api/cron/ai-tasks (the Netlify scheduled fn doesn't fire on
--     this project — same root cause as the email drain fix in 00177).

create table if not exists public.staff_briefing_prefs (
  employee_id  uuid primary key references public.employees(id) on delete cascade,
  enabled      boolean not null default false,
  frequency    text    not null default 'daily' check (frequency in ('daily','weekdays','weekly')),
  last_sent_on date,
  updated_at   timestamptz not null default now()
);
alter table public.staff_briefing_prefs enable row level security;
do $$ begin
  create policy "staff manage briefing prefs" on public.staff_briefing_prefs
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Seed sensible defaults: Administrators + Salespeople get a daily briefing; everyone
-- else is off (e.g. DJs don't need it). All editable in Settings → Daily Briefing.
insert into public.staff_briefing_prefs (employee_id, enabled, frequency)
select id, (staff_category in ('Administrators','Salespeople')), 'daily'
from public.employees where is_active
on conflict (employee_id) do nothing;

-- The scheduled task that sends the per-staff briefings (7am company tz, once/day).
insert into public.ai_tasks (key, label, enabled, config)
values ('staff_briefings', 'Daily Staff Briefing', true, '{"hour":7}'::jsonb)
on conflict (key) do update set label = excluded.label;

-- Reschedule the Tasks engine to 5:30am ET (09:30 UTC in summer / 04:30 ET in winter —
-- either way BEFORE the 7am briefing, so each staffer's freshly-generated tasks are listed).
do $$ begin perform cron.unschedule('xos-task-rules'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule(
    'xos-task-rules',
    '30 9 * * *',
    $cron$
    select net.http_post(
      url := 'https://xos.xpressdjs.com/api/cron/task-rules',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select token from public.cron_auth limit 1)),
      timeout_milliseconds := 60000
    );
    $cron$
  );
exception when others then null; end $$;

-- Reliable hourly driver for the AI tasks (morning briefing, staff briefings, vendor
-- matching). The route decides which run this hour in the company tz. Uses the shared
-- cron_auth token (the route also accepts it, alongside CRON_SECRET).
do $$ begin
  perform cron.schedule(
    'xos-ai-tasks',
    '0 * * * *',
    $cron$
    select net.http_post(
      url := 'https://xos.xpressdjs.com/api/cron/ai-tasks',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select token from public.cron_auth limit 1)),
      timeout_milliseconds := 120000
    );
    $cron$
  );
exception when others then null; end $$;
