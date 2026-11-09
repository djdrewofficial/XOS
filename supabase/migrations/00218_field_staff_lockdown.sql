-- Field staff lockdown — PART 2 of 2. Apply only AFTER 00217 and AFTER the web
-- code that reads the xos_fs_* views for field staff is deployed.
--
-- Adds one RESTRICTIVE policy named "field staff scope" per table (ANDed with
-- the existing permissive policies — precedent: 00197_marketing_role.sql).
-- Every expression starts with `xos_sees_all_events() or …`, which is true for
-- office tiers and for every non-employee login (clients, guests), so ONLY
-- field staff (employee / marketing / null tier) are affected.
--
-- Field staff read events / venues / packages / add-ons / staff through the
-- money-free definer views from 00217 instead of the base tables.
--
-- Rollback: 00218_down.sql drops every "field staff scope" policy (no data touched).
-- Safe to re-run.

do $$
declare
  t text;
  expr text;
  -- 1) denied entirely (money, pricing, raw events/venues, documents, logs, settings)
  deny text[] := array[
    'payments', 'scheduled_payments', 'pay_verifications',
    'expenses', 'expense_settings', 'expense_categories',
    'payroll_payables', 'payroll_payments', 'payroll_settings',
    'payment_settings', 'payment_reminder_rules', 'payment_reminder_sends',
    'event_trips',
    'packages', 'package_versions', 'package_date_prices', 'package_addon_defaults',
    'addons', 'addon_versions', 'event_addons',
    'events', 'venues',
    'documents', 'document_views', 'document_templates',
    'event_logs', 'client_notes', 'email_log', 'booking_helper_runs', 'scheduled_email_runs',
    'company_settings',
    'fireflies_meetings', 'fireflies_suggested_tasks'];
  -- 3) rows of assigned events only (table has event_id)
  assigned text[] := array[
    'event_notes', 'event_vendors', 'event_equipment', 'event_clients', 'event_custom_dates',
    'planning_sections', 'planning_questions', 'planning_question_answers', 'planning_songs',
    'planning_section_staff_notes', 'planning_audit_log', 'planning_do_not_play_notes',
    'event_photobooth_selection', 'song_ideas', 'song_idea_lists',
    'event_guests', 'event_app_invites', 'event_content_reports',
    'run_of_show_jobs', 'vendor_match_suggestions',
    'ai_consents', 'sms_marketing_consent_events'];
begin
  foreach t in array deny loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "field staff scope" on public.%I', t);
    execute format(
      'create policy "field staff scope" on public.%I as restrictive for all to authenticated
         using (xos_sees_all_events()) with check (xos_sees_all_events())', t);
  end loop;

  foreach t in array assigned loop
    if to_regclass('public.' || t) is null then continue; end if;
    expr := 'xos_sees_all_events() or xos_is_assigned(event_id)';
    execute format('drop policy if exists "field staff scope" on public.%I', t);
    execute format(
      'create policy "field staff scope" on public.%I as restrictive for all to authenticated
         using (%s) with check (%s)', t, expr, expr);
  end loop;
end $$;

-- 1b) configuration tables: field staff may READ (role grid, layouts, staff
-- settings, helper list, lookups) but never write — the permissive
-- "staff only" policies otherwise let any staff login rewrite their own access.
do $$
declare
  t text;
  ro text[] := array[
    'role_permissions', 'role_settings', 'dashboard_layouts', 'staff_settings',
    'booking_helpers', 'email_templates', 'merge_tags',
    'notification_settings', 'notification_types',
    'event_statuses', 'event_types', 'inquiry_sources', 'custom_date_definitions',
    'client_role_definitions', 'journey_types', 'journey_settings',
    'planning_templates', 'planning_template_sections', 'planning_template_questions',
    'file_label_definitions', 'daily_status_actions', 'email_blackout_dates'];
begin
  foreach t in array ro loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "field staff scope ins" on public.%I', t);
    execute format('drop policy if exists "field staff scope upd" on public.%I', t);
    execute format('drop policy if exists "field staff scope del" on public.%I', t);
    execute format('create policy "field staff scope ins" on public.%I as restrictive for insert to authenticated
                      with check (xos_sees_all_events())', t);
    execute format('create policy "field staff scope upd" on public.%I as restrictive for update to authenticated
                      using (xos_sees_all_events()) with check (xos_sees_all_events())', t);
    execute format('create policy "field staff scope del" on public.%I as restrictive for delete to authenticated
                      using (xos_sees_all_events())', t);
  end loop;
end $$;

-- 2) own rows only
drop policy if exists "field staff scope" on public.accounts;
create policy "field staff scope" on public.accounts as restrictive for all to authenticated
  using (xos_sees_all_events() or auth_user_id = auth.uid())
  with check (xos_sees_all_events() or auth_user_id = auth.uid());

drop policy if exists "field staff scope" on public.employees;
create policy "field staff scope" on public.employees as restrictive for all to authenticated
  using (xos_sees_all_events() or auth_user_id = auth.uid())
  with check (xos_sees_all_events() or auth_user_id = auth.uid());

drop policy if exists "field staff scope" on public.event_staff;
create policy "field staff scope" on public.event_staff as restrictive for all to authenticated
  using (xos_sees_all_events() or employee_id = xos_current_employee_id())
  with check (xos_sees_all_events() or employee_id = xos_current_employee_id());

drop policy if exists "field staff scope" on public.employee_time_off;
create policy "field staff scope" on public.employee_time_off as restrictive for all to authenticated
  using (xos_sees_all_events() or employee_id = xos_current_employee_id())
  with check (xos_sees_all_events() or employee_id = xos_current_employee_id());

drop policy if exists "field staff scope" on public.employee_permissions;
create policy "field staff scope" on public.employee_permissions as restrictive for all to authenticated
  using (xos_sees_all_events() or employee_id = xos_current_employee_id())
  with check (xos_sees_all_events() or employee_id = xos_current_employee_id());

drop policy if exists "field staff scope" on public.staff_briefing_prefs;
create policy "field staff scope" on public.staff_briefing_prefs as restrictive for all to authenticated
  using (xos_sees_all_events() or employee_id = xos_current_employee_id())
  with check (xos_sees_all_events() or employee_id = xos_current_employee_id());

-- timesheets: the change-request table hangs off event_staff
drop policy if exists "field staff scope" on public.timesheet_change_requests;
create policy "field staff scope" on public.timesheet_change_requests as restrictive for all to authenticated
  using (xos_sees_all_events() or exists (
    select 1 from public.event_staff es
    where es.id = event_staff_id and es.employee_id = xos_current_employee_id()))
  with check (xos_sees_all_events() or exists (
    select 1 from public.event_staff es
    where es.id = event_staff_id and es.employee_id = xos_current_employee_id()));

-- 3b) song likes hang off planning_songs (no event_id column)
drop policy if exists "field staff scope" on public.planning_song_likes;
create policy "field staff scope" on public.planning_song_likes as restrictive for all to authenticated
  using (xos_sees_all_events() or exists (
    select 1 from public.planning_songs s where s.id = song_id and xos_is_assigned(s.event_id)))
  with check (xos_sees_all_events() or exists (
    select 1 from public.planning_songs s where s.id = song_id and xos_is_assigned(s.event_id)));

-- 4) narrower rules
-- event_files: timeline files of assigned events only (bucket gets the same rule in 00217)
drop policy if exists "field staff scope" on public.event_files;
create policy "field staff scope" on public.event_files as restrictive for all to authenticated
  using (xos_sees_all_events() or xos_fs_can_read_event_file(event_id, label_id, source))
  with check (xos_sees_all_events() or xos_fs_can_read_event_file(event_id, label_id, source));

-- clients: only clients of assigned events
drop policy if exists "field staff scope" on public.clients;
create policy "field staff scope" on public.clients as restrictive for all to authenticated
  using (xos_sees_all_events() or id in (select xos_assigned_client_ids()))
  with check (xos_sees_all_events() or id in (select xos_assigned_client_ids()));

-- comms: clients of events where the caller's assignment role contains "DJ"
drop policy if exists "field staff scope" on public.hl_conversations;
create policy "field staff scope" on public.hl_conversations as restrictive for all to authenticated
  using (xos_sees_all_events() or xos_can_message_client(client_id))
  with check (xos_sees_all_events() or xos_can_message_client(client_id));

drop policy if exists "field staff scope" on public.hl_messages;
create policy "field staff scope" on public.hl_messages as restrictive for all to authenticated
  using (xos_sees_all_events() or xos_can_read_conversation(conversation_id))
  with check (xos_sees_all_events() or xos_can_read_conversation(conversation_id));

drop policy if exists "field staff scope" on public.sms_log;
create policy "field staff scope" on public.sms_log as restrictive for all to authenticated
  using (xos_sees_all_events() or xos_can_message_client(client_id))
  with check (xos_sees_all_events() or xos_can_message_client(client_id));

notify pgrst, 'reload schema';
