-- Surface scheduler helper failures instead of swallowing them. run_scheduled_emails
-- ran its optional per-template helper (sched_run_helper_id) inside
-- `exception when others then null`, so a helper that started failing (bad merge tag,
-- deleted status) silently no-op'd forever with no operator signal. Log the failure to
-- event_logs (the same pattern auto_run_helpers already uses) so it shows on the event
-- timeline.
--
-- Patched in-place off the LIVE definition (no hand-transcription of the 8.6KB body);
-- aborts if the swallow block isn't present exactly once.
do $$
declare src text; newsrc text; n int;
begin
  src := pg_get_functiondef('public.run_scheduled_emails()'::regprocedure);
  select count(*) into n from regexp_matches(src, 'exception when others then null', 'g');
  if n <> 1 then
    raise exception 'run_scheduled_emails: expected exactly one swallow block, found % - aborting', n;
  end if;
  newsrc := replace(
    src,
    'exception when others then null; end;',
    'exception when others then insert into event_logs (event_id, actor, action) values (e.id, ''system'', ''Scheduled helper did not run: '' || sqlerrm); end;'
  );
  execute newsrc;
end $$;
