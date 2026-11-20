-- Helper recipient selection (email / SMS).
--
-- Per send_email / send_sms action (to = client), an optional jsonb
-- "recipients" object chooses who gets the message:
--   { "mode": "default"|"all"|"primary"|"contract_holder"|"roles", "roles": ["planner", ...] }
-- mode "default" (or missing) = today's behavior: events.client_id / primary only.
--
-- Manual runs may pass p_recipient_overrides jsonb keyed by action index:
--   { "<index>": { "client_ids": ["..."] } | { "skip": true } }
-- When client_ids is present it replaces the template mode for that run.
-- Contacts missing email (email steps) or phone (SMS steps) are skipped with
-- a performed[] note — never silently redirected to someone else.
--
-- UNAPPLIED until Drew approves. App code falls back when this is missing.


create or replace function public.xos_resolve_helper_recipients(
  p_event_id uuid,
  p_recipients jsonb,
  p_override jsonb
)
returns table (
  client_id uuid,
  email text,
  cell_phone text,
  first_name text,
  last_name text,
  role text,
  is_primary boolean,
  is_contract_holder boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_mode text := lower(coalesce(p_recipients->>'mode', 'default'));
  v_has_override boolean := p_override is not null and p_override ? 'client_ids';
begin
  -- Staff override: exact client ids (may be empty = send to nobody).
  if v_has_override then
    return query
      select c.id, c.email, c.cell_phone, c.first_name, c.last_name,
             ec.role, coalesce(ec.is_primary, false), coalesce(ec.is_contract_holder, false)
      from jsonb_array_elements_text(coalesce(p_override->'client_ids', '[]'::jsonb)) with ordinality as x(id_text, ord)
      join clients c on c.id = x.id_text::uuid
      left join event_clients ec on ec.event_id = p_event_id and ec.client_id = c.id
      order by x.ord;
    return;
  end if;

  if v_mode not in ('default', 'all', 'primary', 'contract_holder', 'roles') then
    v_mode := 'default';
  end if;

  if v_mode in ('default', 'primary') then
    return query
      select c.id, c.email, c.cell_phone, c.first_name, c.last_name,
             ec.role, true, coalesce(ec.is_contract_holder, false)
      from events e
      join clients c on c.id = e.client_id
      left join event_clients ec on ec.event_id = e.id and ec.client_id = c.id
      where e.id = p_event_id;
    return;
  end if;

  if v_mode = 'all' then
    return query
      select c.id, c.email, c.cell_phone, c.first_name, c.last_name,
             ec.role, coalesce(ec.is_primary, false), coalesce(ec.is_contract_holder, false)
      from event_clients ec
      join clients c on c.id = ec.client_id
      where ec.event_id = p_event_id
      order by ec.is_primary desc, ec.created_at nulls last, c.last_name, c.first_name;
    return;
  end if;

  if v_mode = 'contract_holder' then
    return query
      select c.id, c.email, c.cell_phone, c.first_name, c.last_name,
             ec.role, coalesce(ec.is_primary, false), true
      from event_clients ec
      join clients c on c.id = ec.client_id
      where ec.event_id = p_event_id and coalesce(ec.is_contract_holder, false) = true
      order by ec.created_at nulls last;
    return;
  end if;

  -- roles mode
  return query
    select distinct on (c.id)
           c.id, c.email, c.cell_phone, c.first_name, c.last_name,
           ec.role, coalesce(ec.is_primary, false), coalesce(ec.is_contract_holder, false)
    from event_clients ec
    join clients c on c.id = ec.client_id
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(p_recipients->'roles') = 'array' and jsonb_array_length(p_recipients->'roles') > 0
          then p_recipients->'roles'
        else '["primary"]'::jsonb
      end
    ) as r(role_key)
    where ec.event_id = p_event_id
      and (
        lower(r.role_key) in ('all_clients', 'all')
        or (lower(r.role_key) = 'primary' and coalesce(ec.is_primary, false))
        or (lower(r.role_key) in ('contract_holder', 'contract holder') and coalesce(ec.is_contract_holder, false))
        or lower(coalesce(ec.role, '')) = lower(r.role_key)
      )
    order by c.id, ec.is_primary desc;
end;
$fn$;

revoke all on function public.xos_resolve_helper_recipients(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.xos_resolve_helper_recipients(uuid, jsonb, jsonb) to service_role;


create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb, p_manual boolean, p_recipient_overrides jsonb)
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
  recip record;         -- resolved client recipient row
  v_recip_ovr jsonb;    -- per-action recipient override
  v_queued int;
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
      else
        v_recip_ovr := case when p_recipient_overrides is null then null else p_recipient_overrides -> v_idx::text end;
        if coalesce(v_recip_ovr->>'skip', '') in ('true', '1') then
          performed := performed || jsonb_build_object('send_email_skipped', 'operator declined');
        else
          v_sender := resolve_sender(p_event_id, coalesce(act->>'from', 'company'));
          v_queued := 0;
          for recip in
            select * from public.xos_resolve_helper_recipients(p_event_id, act->'recipients', v_recip_ovr)
          loop
            if recip.email is null or recip.email = '' then
              performed := performed || jsonb_build_object(
                'send_email_skipped',
                coalesce(nullif(btrim(coalesce(recip.first_name,'') || ' ' || coalesce(recip.last_name,'')), ''), recip.client_id::text)
                  || ': no recipient email'
              );
            else
              insert into email_log (event_id, client_id, template_id, to_address,
                                     from_name, from_address, reply_to, subject, body_html, status,
                                     bypass_comms_pause)
              values (
                p_event_id, recip.client_id, t.id, recip.email,
                v_sender->>'name', v_sender->>'email', v_sender->>'reply_to',
                render_merge_tags(p_event_id, t.subject),
                render_merge_tags(p_event_id, t.body_html),
                'queued',
                p_manual
              );
              v_queued := v_queued + 1;
              performed := performed || jsonb_build_object('send_email_queued', recip.email);
            end if;
          end loop;
          if v_queued = 0 and not exists (
            select 1 from public.xos_resolve_helper_recipients(p_event_id, act->'recipients', v_recip_ovr)
          ) then
            performed := performed || jsonb_build_object('send_email_skipped', 'no matching contacts');
          end if;
        end if;
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
      else
        v_recip_ovr := case when p_recipient_overrides is null then null else p_recipient_overrides -> v_idx::text end;
        if coalesce(v_recip_ovr->>'skip', '') in ('true', '1') then
          performed := performed || jsonb_build_object('send_sms_skipped', 'operator declined');
        else
          v_queued := 0;
          -- Load template once when present (v_sms_tpl_id avoids a null record.t.id touch).
          if coalesce(act->>'template_id', '') <> '' then
            select * into t from email_templates
              where id = (act->>'template_id')::uuid and is_active and is_sms;
            if not found then raise exception 'send_sms: SMS template not found'; end if;
          end if;
          for recip in
            select * from public.xos_resolve_helper_recipients(p_event_id, act->'recipients', v_recip_ovr)
          loop
            if recip.cell_phone is null or recip.cell_phone = '' then
              performed := performed || jsonb_build_object(
                'send_sms_skipped',
                coalesce(nullif(btrim(coalesce(recip.first_name,'') || ' ' || coalesce(recip.last_name,'')), ''), recip.client_id::text)
                  || ': no cell number'
              );
            else
              if coalesce(act->>'template_id', '') <> '' then
                insert into sms_log (event_id, client_id, to_number, body, status, is_marketing,
                                     bypass_comms_pause)
                values (p_event_id, recip.client_id, recip.cell_phone,
                        coalesce(v_body, xos_html_to_sms(render_merge_tags(p_event_id, t.body_html))),
                        'queued', coalesce(t.sms_marketing, false), p_manual);
              else
                insert into sms_log (event_id, client_id, to_number, body, status, bypass_comms_pause)
                values (p_event_id, recip.client_id, recip.cell_phone,
                        coalesce(v_body, render_merge_tags(p_event_id, act->>'body')), 'queued', p_manual);
              end if;
              v_queued := v_queued + 1;
              performed := performed || jsonb_build_object('send_sms_queued', recip.cell_phone);
            end if;
          end loop;
          if v_queued = 0 and not exists (
            select 1 from public.xos_resolve_helper_recipients(p_event_id, act->'recipients', v_recip_ovr)
          ) then
            performed := performed || jsonb_build_object('send_sms_skipped', 'no matching contacts');
          end if;
        end if;
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
          perform run_booking_helper(v_child, p_event_id, null::jsonb, p_manual, null::jsonb);
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

-- 4-arg engine entry used by existing wrappers: no recipient overrides.
create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb, p_manual boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public.run_booking_helper(p_helper_id, p_event_id, p_sms_overrides, p_manual, null::jsonb);
end;
$function$;

-- Staff click with SMS + recipient overrides (manual = true).
create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb, p_recipient_overrides jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public.run_booking_helper(p_helper_id, p_event_id, p_sms_overrides, true, p_recipient_overrides);
end;
$function$;

-- Staff click (SMS overrides only).
create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid, p_sms_overrides jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public.run_booking_helper(p_helper_id, p_event_id, p_sms_overrides, true, null::jsonb);
end;
$function$;

-- Automations / schedules / after-sign.
create or replace function public.run_booking_helper(p_helper_id uuid, p_event_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return public.run_booking_helper(p_helper_id, p_event_id, null::jsonb, false, null::jsonb);
end;
$function$;

do $$
declare fn text;
  fns text[] := array[
    'public.run_booking_helper(uuid, uuid, jsonb, boolean, jsonb)',
    'public.run_booking_helper(uuid, uuid, jsonb, boolean)',
    'public.run_booking_helper(uuid, uuid, jsonb, jsonb)',
    'public.run_booking_helper(uuid, uuid, jsonb)',
    'public.run_booking_helper(uuid, uuid)',
    'public.xos_resolve_helper_recipients(uuid, jsonb, jsonb)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
