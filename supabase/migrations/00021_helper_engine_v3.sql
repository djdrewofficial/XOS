-- XOS — booking helper engine v3
-- New: set times, email a specific address, email assigned staff/salesperson,
-- secondary helper chaining, and Automation: auto-run when an event is created.

alter table booking_helpers add column if not exists auto_on_create boolean not null default false;
alter table booking_helpers add column if not exists auto_status_ids uuid[] not null default '{}';

create or replace function run_booking_helper(p_helper_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  performed jsonb := '[]'::jsonb;
  pay_count int;
  prior_runs int;
  missing text := '';
  rf text;
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

  for act in select * from jsonb_array_elements(h.actions)
  loop
    case act->>'type'

    when 'set_status' then
      update events set status_id = (act->>'status_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('set_status', act->>'status_id');

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
        insert into email_log (event_id, client_id, template_id, to_address, subject, body_html, status)
        values (
          p_event_id, e.client_id, t.id, v_to,
          render_merge_tags(p_event_id, t.subject),
          render_merge_tags(p_event_id, t.body_html),
          'queued'
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
          insert into email_log (event_id, template_id, to_address, subject, body_html, status)
          values (p_event_id, t.id, emp.email,
                  render_merge_tags(p_event_id, t.subject),
                  render_merge_tags(p_event_id, t.body_html), 'queued');
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
          insert into email_log (event_id, template_id, to_address, subject, body_html, status)
          values (p_event_id, t.id, emp.email,
                  render_merge_tags(p_event_id, t.subject),
                  render_merge_tags(p_event_id, t.body_html), 'queued');
        end loop;
      end if;
      performed := performed || jsonb_build_object('send_email_staff', act->>'audience');

    when 'add_note' then
      insert into event_notes (event_id, body, author_name)
      values (p_event_id, render_merge_tags(p_event_id, act->>'body'), current_actor());
      performed := performed || jsonb_build_object('add_note', true);

    when 'run_helper' then
      v_child := (act->>'helper_id')::uuid;
      if v_child is not null and v_child <> p_helper_id then
        begin
          perform run_booking_helper(v_child, p_event_id);
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
$$;

grant execute on function run_booking_helper(uuid, uuid) to authenticated;

-- ============ AUTOMATION: auto-run helpers when an event is created ============
create or replace function auto_run_helpers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare h record;
begin
  for h in
    select * from booking_helpers
    where is_active and auto_on_create
    order by position
  loop
    if array_length(h.auto_status_ids, 1) is null or new.status_id = any (h.auto_status_ids) then
      begin
        perform run_booking_helper(h.id, new.id);
      exception when others then
        insert into event_logs (event_id, actor, action)
        values (new.id, 'system', 'Auto helper "' || h.title || '" did not run: ' || SQLERRM);
      end;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists events_auto_helpers on events;
create trigger events_auto_helpers after insert on events
  for each row execute function auto_run_helpers();
