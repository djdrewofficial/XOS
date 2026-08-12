-- TCPA: gate marketing (non-transactional) SMS on recorded consent.
-- - sms_log.is_marketing flags a queued message as marketing (default false =
--   transactional, unaffected).
-- - email_templates.sms_marketing lets staff designate an SMS template as
--   promotional; the booking-helper send_sms path propagates it to sms_log.
-- processSmsOutbox suppresses a marketing message to a client who hasn't recorded
-- SMS consent (clients.sms_opt_in). Transactional SMS (payment reminders, codes,
-- coordination) keep sending as before.

alter table public.sms_log add column if not exists is_marketing boolean not null default false;
alter table public.email_templates add column if not exists sms_marketing boolean not null default false;

-- Wire the flag into run_booking_helper's client send_sms (template path). Patched
-- in-place off the live definition; aborts if the exact insert isn't found once.
do $$
declare
  src text; newsrc text; n int;
  oldtxt text := 'insert into sms_log (event_id, client_id, to_number, body, status)'
    || E'\n          values (p_event_id, e.client_id, v_to,'
    || E'\n                  xos_html_to_sms(render_merge_tags(p_event_id, t.body_html)), ''queued'');';
  newtxt text := 'insert into sms_log (event_id, client_id, to_number, body, status, is_marketing)'
    || E'\n          values (p_event_id, e.client_id, v_to,'
    || E'\n                  xos_html_to_sms(render_merge_tags(p_event_id, t.body_html)), ''queued'', coalesce(t.sms_marketing, false));';
begin
  src := pg_get_functiondef('public.run_booking_helper(uuid,uuid)'::regprocedure);
  n := (length(src) - length(replace(src, oldtxt, ''))) / length(oldtxt);
  if n <> 1 then
    raise exception 'run_booking_helper: send_sms template insert found % times (expected 1) - aborting', n;
  end if;
  newsrc := replace(src, oldtxt, newtxt);
  execute newsrc;
end $$;
