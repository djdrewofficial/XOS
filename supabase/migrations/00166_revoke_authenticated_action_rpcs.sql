-- SECURITY (follow-up to 00146): the side-effecting ACTION functions were still
-- executable by the `authenticated` role, so a signed-in client/guest portal
-- account could POST /rpc/run_payment_reminders (blast reminders), /rpc/
-- run_scheduled_emails, /rpc/run_booking_helper, /rpc/create_notification, etc.
--
-- Revoke EXECUTE from `authenticated`; keep service_role (granted in 00146) + the
-- function owner. Every legitimate app caller was switched to the service-role
-- admin client, and internal / trigger / cron callers run as the function owner
-- (SECURITY DEFINER) so they are unaffected by this revoke.
--
-- NOT touched: save_social_handles (a genuine client-portal action, stays callable
-- by authenticated), the trigger functions apply_auto_mileage / auto_run_helpers
-- (fire only as triggers, not a /rpc vector), and the RLS-helper predicates.

do $$
declare fn text;
  fns text[] := array[
    'public.run_payment_reminders()',
    'public.run_scheduled_emails()',
    'public.run_daily_status_actions()',
    'public.run_auto_mileage()',
    'public.run_booking_helper(uuid, uuid)',
    'public.create_notification(text, text, text, text)',
    'public.create_targeted_notification(text, text, text, text, uuid, text[])'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from authenticated', fn);
  end loop;
end $$;
