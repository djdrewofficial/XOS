-- SECURITY: stop the public `anon` role from executing side-effecting SECURITY
-- DEFINER functions over the PostgREST /rpc/ API. The Supabase anon key is public,
-- so these were callable unauthenticated (e.g. POST /rpc/run_payment_reminders to
-- blast reminders, or /rpc/render_merge_tags to read any event's details).
--
-- We revoke EXECUTE from PUBLIC + anon and re-grant to authenticated + service_role,
-- so every real caller keeps working: staff (authenticated sessions), the public
-- token flows and cron (service-role admin client / DB owner), and internal
-- SECURITY DEFINER callers (run as the function owner).
--
-- NOT touched: the RLS-helper predicates (xos_is_staff, xos_can_access_event,
-- xos_is_host, xos_guest_of, xos_my_client_id, current_actor, xos_current_*) —
-- those MUST stay executable by authenticated or every RLS policy that calls them
-- breaks. Trigger functions are harmless (they only fire as triggers).
--
-- FOLLOW-UP (separate change): the run_* action functions are still executable by
-- `authenticated`, so a signed-in couple could call them. Closing that requires
-- switching their staff-session callers (settings/events actions, automations) to
-- the admin client, or adding an `auth.uid() is null or xos_is_staff()` guard —
-- deferred to avoid a broad, breakage-prone refactor here.

do $$
declare
  fn text;
  fns text[] := array[
    'public.run_payment_reminders()',
    'public.run_scheduled_emails()',
    'public.run_booking_helper(uuid, uuid)',
    'public.run_daily_status_actions()',
    'public.run_auto_mileage()',
    'public.apply_auto_mileage()',
    'public.auto_run_helpers()',
    'public.create_notification(text, text, text, text)',
    'public.create_targeted_notification(text, text, text, text, uuid, text[])',
    'public.save_social_handles(text, text)',
    'public.social_prompt_state()',
    'public.company_public_info()',
    'public.get_community_authors(uuid[])',
    'public.render_merge_tags(uuid, text)',
    'public.resolve_sender(uuid, text)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
