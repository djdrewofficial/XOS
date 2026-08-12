-- pg_cron liveness probe for the queueing engines.
--
-- The three queueing jobs (run_scheduled_emails every 15 min, run_payment_reminders
-- + run_daily_status_actions daily) are registered ONLY through pg_cron. pg_cron is
-- an opt-in extension that can silently stop after a restore/plan change — and
-- nothing errors: the outbox drainer keeps reporting "sent 0, healthy" while no
-- reminders or scheduled emails are ever queued.
--
-- cron.job / cron.job_run_details live in the `cron` schema and are not readable by
-- the service-role API user. This SECURITY DEFINER helper (owned by postgres, which
-- owns pg_cron) exposes, per job, its active flag + minutes since its last ACTUAL
-- run from pg_cron's own execution log. The send-outbox cron (driven by an external
-- scheduler, independent of pg_cron) uses it to run any engine pg_cron has missed
-- and to alert — closing the silent-failure gap.

create or replace function public.cron_job_health()
returns table (
  jobname       text,
  active        boolean,
  last_run      timestamptz,
  last_status   text,
  minutes_since numeric
)
language sql
security definer
set search_path = cron, public
as $$
  select j.jobname,
         j.active,
         lr.last_run,
         lr.last_status,
         round(extract(epoch from (now() - lr.last_run)) / 60, 1) as minutes_since
  from cron.job j
  left join lateral (
    select d.start_time as last_run, d.status as last_status
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc
    limit 1
  ) lr on true;
$$;

-- Read-only diagnostic, but it reads the cron schema via SECURITY DEFINER, so keep
-- it off the public/anon/authenticated API surface — only the service-role cron needs it.
revoke all on function public.cron_job_health() from public;
revoke all on function public.cron_job_health() from anon;
revoke all on function public.cron_job_health() from authenticated;
grant execute on function public.cron_job_health() to service_role;
