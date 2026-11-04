-- Manual booking-helper sends ignore the per-event comms pause.
--
-- events.comms_paused stops automated client email and SMS at the outbox drain
-- (processOutbox / processSmsOutbox). It was also cancelling a helper a person
-- clicked, including the internal copy, because every send_email / send_sms row
-- is stamped with the event's client_id and the drain only looked at that plus
-- comms_paused. Nothing on the row said who triggered it.
--
-- Origin is the existing entry point, carried onto the queued row:
--   * 3-arg run_booking_helper(uuid, uuid, jsonb) is the staff click
--     (runBookingHelper always passes p_sms_overrides). It calls the engine
--     with p_manual = true, and every email/SMS row gets bypass_comms_pause.
--   * 2-arg run_booking_helper(uuid, uuid) is every automatic caller:
--     auto_run_helpers, runAutomations (auto_on_create / auto_on_signed /
--     auto_on_payment / auto_on_proposal_confirmed / auto_status_ids),
--     run_scheduled_emails' sched_run_helper_id, and the after-sign helper.
--     It calls the engine with p_manual = false. Scheduled emails and payment
--     reminders insert into the logs themselves and leave the column false.
--   * A run_helper action passes the parent's p_manual through, so a helper
--     a person clicked that chains another helper stays a manual send. A
--     chain that started from a schedule or automation stays paused.
--   * email_templates.after_run_helper_id is stored and editable, but nothing
--     in the app or the database calls it. It is not a send path today.
--
-- Other helper actions (status, notes, dates) were never gated by the pause.
-- Staff rows with a null client_id were already delivered; the flag is still
-- set on them so the origin stays visible.
--
-- The 2-arg wrapper must call the 4-arg engine directly. Calling the 3-arg
-- wrapper would mark every automation as manual.

alter table public.email_log
  add column if not exists bypass_comms_pause boolean not null default false;

alter table public.sms_log
  add column if not exists bypass_comms_pause boolean not null default false;

create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb, p_manual boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  h record;
  e record;
  act jsonb;
  c record;
  t record;
  emp record;
  v_date date;
  v_field text;
  v_to text;
  v_def uuid;
  v_child uuid;
  v_sender jsonb;
  v_company jsonb;
  performed jsonb := '[]'::jsonb;
  pay_count int;
  prior_runs int;
  missing text := '';
  rf text;
  v_idx int := -1;      -- index of the current action inside h.actions
  v_ovr jsonb;          -- operator override for this action (prompted SMS only)
  v_body text;          -- operator-edited SMS body, already merge-tag rendered
begin
  select * into h from booking_helpers where id = p_helper_id and is_active;
  if not found then raise exception 'Booking helper not found or inactive'; end if;

  select * into e from events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;

  if array_length(h.visible_status_ids, 1) is not null
     and not (e.status_id = any (h.visible_status_ids)) then
    raise exception 'Helper not available for this event status';
  end if;
  if h.hide_if_payment_made then
    select count(*) into pay_count from payments where event_id = p_event_id;
    if pay_count > 0 then raise exception 'Helper hidden: a payment exists'; end if;
  end if;
  if h.hide_if_already_ran then
    select count(*) into prior_runs from booking_helper_runs
      where helper_id = p_helper_id and event_id = p_event_id;
    if prior_runs > 0 then raise exception 'Helper already ran for this event'; end if;
  end if;
  if array_length(h.hide_if_helpers_ran, 1) is not null then
    select count(*) into prior_runs from booking_helper_runs
      where event_id = p_event_id and helper_id = any (h.hide_if_helpers_ran);
    if prior_runs > 0 then raise exception 'Helper hidden: a blocking helper already ran'; end if;
  end if;

  if array_length(h.event_type_ids, 1) is not null
     and (e.event_type_id is null or not (e.event_type_id = any (h.event_type_ids))) then
    return jsonb_build_object('helper', h.title, 'skipped', 'event type not in scope');
  end if;

  select * into c from clients where id = e.client_id;

  foreach rf in array h.required_fields
  loop
    if (rf = 'event_date' and e.event_date is null)
       or (rf = 'setup_time' and e.setup_time is null)
       or (rf = 'start_time' and e.start_time is null)
       or (rf = 'end_time' and e.end_time is null)
       or (rf = 'guest_count' and e.guest_count is null)
       or (rf = 'venue' and e.venue_id is null)
       or (rf = 'package' and e.package_id is null)
       or (rf = 'client' and e.client_id is null)
       or (rf = 'client_email' and (c.email is null or c.email = ''))
       or (rf = 'client_cell' and (c.cell_phone is null or c.cell_phone = ''))
       or (rf = 'event_name' and (e.name is null or e.name = ''))
    then
      missing := missing || case when missing = '' then '' else ', ' end || replace(rf, '_', ' ');
    end if;
  end loop;
  if missing <> '' then
    raise exception 'Cannot run — required fields are blank: %', missing;
  end if;

  v_company := resolve_sender(p_event_id, 'company');

  for act in select * from jsonb_array_elements(h.actions)
  loop
    v_idx := v_idx + 1;

    -- "Prompt to send text": an SMS action flagged prompt = true is confirmed by
    -- the operator at click time, so the caller may pass an override for it —
    -- skip it entirely (texting the client from a personal phone instead), or
    -- send an edited body. Overrides are keyed by the action's index in
    -- h.actions and are ignored for anything that isn't a prompt-enabled SMS,
    -- so automations (which pass no overrides) behave exactly as before.
    v_ovr := case
      when p_sms_overrides is null then null
      when act->>'type' not in ('send_sms', 'send_sms_staff') then null
      when coalesce(act->>'prompt', 'false') not in ('true', '1', 'on') then null
      else p_sms_overrides -> v_idx::text
    end;
    if coalesce(v_ovr->>'skip', '') in ('true', '1') then
      performed := performed || jsonb_build_object('send_sms_skipped', 'operator declined');
      continue;
    end if;
    v_body := nullif(btrim(coalesce(v_ovr->>'body', '')), '');
    if v_body is not null then
      v_body := render_merge_tags(p_event_id, v_body);
    end if;

    case act->>'type'

    when 'set_status' then
      update events set status_id = (act->>'status_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('set_status', act->>'status_id');

    when 'start_journey' then
      update events set journey_type_id = (act->>'journey_type_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('start_journey', act->>'journey_type_id');

    when 'set_event_type' then
      update events set event_type_id = (act->>'event_type_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('set_event_type', true);

    when 'set_event_name' then
      update events set name = render_merge_tags(p_event_id, act->>'value') where id = p_event_id;
      performed := performed || jsonb_build_object('set_event_name', true);

    when 'set_inquiry_source' then
      update events set inquiry_source_id = (act->>'inquiry_source_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('set_inquiry_source', true);

    when 'set_salesperson' then
      update events set salesperson_id = (act->>'employee_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('set_salesperson', true);

    when 'set_date' then
      v_field := act->>'field';
      if v_field not in ('initial_contact_date','contract_sent_date','contract_due_date',
                         'contract_signed_date','quote_sent_date','event_date','booked_date') then
        raise exception 'set_date: field % not allowed', v_field;
      end if;
      if act->>'value' = 'today' then
        v_date := current_date;
      elsif left(act->>'value', 1) = '+' then
        v_date := current_date + (substring(act->>'value' from 2))::int;
      else
        v_date := (act->>'value')::date;
      end if;
      execute format('update events set %I = $1 where id = $2', v_field)
        using v_date, p_event_id;
      performed := performed || jsonb_build_object('set_date', v_field || '=' || v_date::text);

    when 'set_custom_date' then
      v_def := (act->>'definition_id')::uuid;
      if act->>'value' = 'today' then
        v_date := current_date;
      elsif left(act->>'value', 1) = '+' then
        v_date := current_date + (substring(act->>'value' from 2))::int;
      else
        v_date := (act->>'value')::date;
      end if;
      insert into event_custom_dates (event_id, definition_id, value)
      values (p_event_id, v_def, v_date)
      on conflict (event_id, definition_id) do update set value = excluded.value;
      performed := performed || jsonb_build_object('set_custom_date', v_date::text);

    when 'set_time' then
      v_field := act->>'field';
      if v_field not in ('setup_time','start_time','end_time') then
        raise exception 'set_time: field % not allowed', v_field;
      end if;
      execute format('update events set %I = $1 where id = $2', v_field)
        using (act->>'value')::time, p_event_id;
      performed := performed || jsonb_build_object('set_time', v_field);

    when 'setup_before_start' then
      update events set setup_time = start_time - ((act->>'minutes')::int * interval '1 minute')
      where id = p_event_id and start_time is not null;
      performed := performed || jsonb_build_object('setup_before_start', act->>'minutes');

    when 'mark_staff_notified' then
      update event_staff set notified_at = now()
      where event_id = p_event_id and notified_at is null;
      performed := performed || jsonb_build_object('mark_staff_notified', true);

    when 'assign_employee' then
      insert into event_staff (event_id, employee_id, role)
      select p_event_id, (act->>'employee_id')::uuid, coalesce(act->>'role', 'DJ')
      where not exists (
        select 1 from event_staff
        where event_id = p_event_id and employee_id = (act->>'employee_id')::uuid
      );
      performed := performed || jsonb_build_object('assign_employee', true);

    when 'send_email' then
      select * into t from email_templates where id = (act->>'template_id')::uuid and is_active;
      if not found then raise exception 'send_email: template not found'; end if;
      if act->>'to' = 'custom' then
        v_to := act->>'address';
      else
        v_to := c.email;
      end if;
      if v_to is null or v_to = '' then
        performed := performed || jsonb_build_object('send_email_skipped', 'no recipient email');
      else
        v_sender := resolve_sender(p_event_id, coalesce(act->>'from', 'company'));
        insert into email_log (event_id, client_id, template_id, to_address,
                               from_name, from_address, reply_to, subject, body_html, status,
                               bypass_comms_pause)
        values (
          p_event_id, e.client_id, t.id, v_to,
          v_sender->>'name', v_sender->>'email', v_sender->>'reply_to',
          render_merge_tags(p_event_id, t.subject),
          render_merge_tags(p_event_id, t.body_html),
          'queued',
          p_manual
        );
        performed := performed || jsonb_build_object('send_email_queued', v_to);
      end if;

    when 'send_email_staff' then
      select * into t from email_templates where id = (act->>'template_id')::uuid and is_active;
      if not found then raise exception 'send_email_staff: template not found'; end if;
      if act->>'audience' = 'salesperson' then
        for emp in
          select em.email from employees em where em.id = e.salesperson_id and em.email is not null
        loop
          insert into email_log (event_id, template_id, to_address,
                                 from_name, from_address, reply_to, subject, body_html, status,
                                 bypass_comms_pause)
          values (p_event_id, t.id, emp.email,
                  v_company->>'name', v_company->>'email', v_company->>'reply_to',
                  render_merge_tags(p_event_id, t.subject),
                  render_merge_tags(p_event_id, t.body_html), 'queued', p_manual);
        end loop;
      else
        for emp in
          select em.email from event_staff es
          join employees em on em.id = es.employee_id
          where es.event_id = p_event_id and em.email is not null
            and (act->>'audience' = 'all'
                 or (act->>'audience' = 'not_notified' and es.notified_at is null)
                 or (act->>'audience' = 'not_confirmed' and es.confirmed_at is null and es.declined_at is null))
        loop
          insert into email_log (event_id, template_id, to_address,
                                 from_name, from_address, reply_to, subject, body_html, status,
                                 bypass_comms_pause)
          values (p_event_id, t.id, emp.email,
                  v_company->>'name', v_company->>'email', v_company->>'reply_to',
                  render_merge_tags(p_event_id, t.subject),
                  render_merge_tags(p_event_id, t.body_html), 'queued', p_manual);
        end loop;
      end if;
      performed := performed || jsonb_build_object('send_email_staff', act->>'audience');

    when 'send_sms' then
      if act->>'to' = 'custom' then
        v_to := act->>'number';
      else
        v_to := c.cell_phone;
      end if;
      if v_to is null or v_to = '' then
        performed := performed || jsonb_build_object('send_sms_skipped', 'no cell number');
      else
        if coalesce(act->>'template_id', '') <> '' then
          select * into t from email_templates
            where id = (act->>'template_id')::uuid and is_active and is_sms;
          if not found then raise exception 'send_sms: SMS template not found'; end if;
          insert into sms_log (event_id, client_id, to_number, body, status, is_marketing,
                               bypass_comms_pause)
          values (p_event_id, e.client_id, v_to,
                  coalesce(v_body, xos_html_to_sms(render_merge_tags(p_event_id, t.body_html))),
                  'queued', coalesce(t.sms_marketing, false), p_manual);
        else
          insert into sms_log (event_id, client_id, to_number, body, status, bypass_comms_pause)
          values (p_event_id, e.client_id, v_to,
                  coalesce(v_body, render_merge_tags(p_event_id, act->>'body')), 'queued', p_manual);
        end if;
        performed := performed || jsonb_build_object('send_sms_queued', v_to);
      end if;

    when 'send_sms_staff' then
      select * into t from email_templates
        where id = (act->>'template_id')::uuid and is_active and is_sms;
      if not found then raise exception 'send_sms_staff: SMS template not found'; end if;
      if act->>'audience' = 'salesperson' then
        for emp in
          select em.phone from employees em
          where em.id = e.salesperson_id and em.phone is not null and em.phone <> ''
        loop
          insert into sms_log (event_id, to_number, body, status, bypass_comms_pause)
          values (p_event_id, emp.phone,
                  coalesce(v_body, xos_html_to_sms(render_merge_tags(p_event_id, t.body_html))), 'queued', p_manual);
        end loop;
      else
        for emp in
          select em.phone from event_staff es
          join employees em on em.id = es.employee_id
          where es.event_id = p_event_id and em.phone is not null and em.phone <> ''
            and (act->>'audience' = 'all'
                 or (act->>'audience' = 'not_notified' and es.notified_at is null)
                 or (act->>'audience' = 'not_confirmed' and es.confirmed_at is null and es.declined_at is null))
        loop
          insert into sms_log (event_id, to_number, body, status, bypass_comms_pause)
          values (p_event_id, emp.phone,
                  coalesce(v_body, xos_html_to_sms(render_merge_tags(p_event_id, t.body_html))), 'queued', p_manual);
        end loop;
      end if;
      performed := performed || jsonb_build_object('send_sms_staff', act->>'audience');

    when 'add_note' then
      insert into event_notes (event_id, body, author_name)
      values (p_event_id, render_merge_tags(p_event_id, act->>'body'), current_actor());
      performed := performed || jsonb_build_object('add_note', true);

    when 'run_helper' then
      v_child := (act->>'helper_id')::uuid;
      if v_child is not null and v_child <> p_helper_id then
        begin
          perform run_booking_helper(v_child, p_event_id, null::jsonb, p_manual);
          performed := performed || jsonb_build_object('run_helper', v_child);
        exception when others then
          performed := performed || jsonb_build_object('run_helper_failed', SQLERRM);
        end;
      end if;

    else
      raise exception 'Unknown action type: %', act->>'type';
    end case;
  end loop;

  insert into booking_helper_runs (helper_id, event_id) values (p_helper_id, p_event_id);

  return jsonb_build_object('helper', h.title, 'performed', performed);
end;
$function$;

-- Staff click. p_sms_overrides may be null; the signature itself is the
-- manual signal, matching 00190 (only runBookingHelper passes it).
create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public.run_booking_helper(p_helper_id, p_event_id, p_sms_overrides, true);
end;
$function$;

-- Automations, schedulers, the after-sign helper, and the event-insert
-- trigger. No default on the boolean, so this 2-arg call stays unambiguous.
create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public.run_booking_helper(p_helper_id, p_event_id, null::jsonb, false);
end;
$function$;

-- Same lockdown as 00190: the app calls the 3-arg form with the service-role
-- client. The 4-arg engine is not a separate public entry point.
do $$
declare fn text;
  fns text[] := array[
    'public.run_booking_helper(uuid, uuid, jsonb, boolean)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
