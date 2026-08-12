-- run_scheduled_emails queues into email_log BEFORE it writes its
-- scheduled_email_runs claim row, so two concurrent runs (the pg_cron tick and an
-- admin's "Run now") both pass the `if exists (scheduled_email_runs)` dedupe check
-- and both queue the same emails. Serialize the whole function with a
-- transaction-scoped advisory lock: the second caller blocks until the first
-- commits, then sees the committed claim rows and skips them (no duplicates).
-- Released automatically at transaction end.
--
-- Patched in-place off the LIVE definition (no hand-transcription of the 8.6KB
-- body); aborts if the anchor isn't found exactly once or a lock already exists.
do $$
declare
  src text; newsrc text; n int;
  anchor text := 'select coalesce(timezone, ''America/New_York''), email_send_window_start';
begin
  src := pg_get_functiondef('public.run_scheduled_emails()'::regprocedure);
  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if n <> 1 then
    raise exception 'run_scheduled_emails: anchor found % times (expected 1) - aborting', n;
  end if;
  if position('pg_advisory_xact_lock' in src) > 0 then
    raise exception 'run_scheduled_emails: advisory lock already present - aborting';
  end if;
  newsrc := replace(src, anchor, 'perform pg_advisory_xact_lock(4771001);' || E'\n  ' || anchor);
  execute newsrc;
end $$;
