-- XOS Beta 2 — booking helper engine, merge tags, email outbox, daily runner
-- Backend-first: all business logic lives in Postgres so web + future mobile app share it.

-- ============ EMAIL LOG: store rendered content ============
alter table email_log add column if not exists body_html text not null default '';
alter table email_log add column if not exists error text;

-- ============ MERGE TAG RENDERER ============
-- Renders a template against an event. Tag syntax matches DJEP: <first_name>, <event_date_long>, etc.
create or replace function render_merge_tags(p_event_id uuid, p_template text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  c record;
  v record;
  p record;
  out_text text := coalesce(p_template, '');
  v_total numeric := 0;
  v_paid numeric := 0;
  v_addons numeric := 0;
  v_countdown int;
begin
  select * into e from events where id = p_event_id;
  if not found then return out_text; end if;

  select * into c from clients where id = e.client_id;
  select * into v from venues where id = e.venue_id;
  select * into p from packages where id = e.package_id;

  select coalesce(sum(quantity * coalesce(ea.price_override, a.default_price)), 0)
    into v_addons
  from event_addons ea join addons a on a.id = ea.addon_id
  where ea.event_id = e.id;

  v_total := coalesce(e.package_price_override, p.default_price, 0)
             + v_addons + e.overtime_fee + e.travel_fee
             - e.discount1_amount - e.discount2_amount;

  select coalesce(sum(amount), 0) into v_paid from payments where event_id = e.id;

  v_countdown := case when e.event_date is null then null
                 else (e.event_date - current_date) end;

  out_text := replace(out_text, '<first_name>', coalesce(c.first_name, ''));
  out_text := replace(out_text, '<last_name>', coalesce(c.last_name, ''));
  out_text := replace(out_text, '<client_name>', trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')));
  out_text := replace(out_text, '<client_email>', coalesce(c.email, ''));
  out_text := replace(out_text, '<client_cell>', coalesce(c.cell_phone, ''));
  out_text := replace(out_text, '<event_name>', coalesce(e.name, ''));
  out_text := replace(out_text, '<event_type>',
    coalesce((select name from event_types where id = e.event_type_id), ''));
  out_text := replace(out_text, '<event_date_long>',
    coalesce(to_char(e.event_date, 'FMDay, FMMonth FMDD, YYYY'), ''));
  out_text := replace(out_text, '<event_date_short>',
    coalesce(to_char(e.event_date, 'MM/DD/YYYY'), ''));
  out_text := replace(out_text, '<event_date_countdown>', coalesce(v_countdown::text, ''));
  out_text := replace(out_text, '<venue_name>', coalesce(v.name, ''));
  out_text := replace(out_text, '<package_name>', coalesce(p.name, ''));
  out_text := replace(out_text, '<total_fee>', to_char(v_total, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<payments_received>', to_char(v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<balance_due>', to_char(v_total - v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<deposit_value>', to_char(e.deposit_value, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<start_time>', coalesce(to_char(e.start_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<end_time>', coalesce(to_char(e.end_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<company_name>', 'Xpress Entertainment');
  out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));

  return out_text;
end;
$$;

-- ============ BOOKING HELPER EXECUTOR ============
-- Actions jsonb format (array):
--   {"type":"set_status","status_id":"<uuid>"}
--   {"type":"set_date","field":"contract_sent_date","value":"today" | "+7" | "YYYY-MM-DD"}
--   {"type":"send_email","template_id":"<uuid>","to":"client" | "custom","address":"x@y.com"}
--   {"type":"add_note","body":"..."}
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
  v_date date;
  v_field text;
  v_to text;
  performed jsonb := '[]'::jsonb;
  pay_count int;
  prior_runs int;
begin
  select * into h from booking_helpers where id = p_helper_id and is_active;
  if not found then raise exception 'Booking helper not found or inactive'; end if;

  select * into e from events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;

  -- enforce visibility conditions server-side
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

  for act in select * from jsonb_array_elements(h.actions)
  loop
    case act->>'type'

    when 'set_status' then
      update events set status_id = (act->>'status_id')::uuid where id = p_event_id;
      performed := performed || jsonb_build_object('set_status', act->>'status_id');

    when 'set_date' then
      v_field := act->>'field';
      if v_field not in ('initial_contact_date','contract_sent_date','contract_due_date',
                         'contract_signed_date','quote_sent_date','event_date') then
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

    when 'add_note' then
      insert into event_notes (event_id, body)
      values (p_event_id, render_merge_tags(p_event_id, act->>'body'));
      performed := performed || jsonb_build_object('add_note', true);

    else
      raise exception 'Unknown action type: %', act->>'type';
    end case;
  end loop;

  insert into booking_helper_runs (helper_id, event_id) values (p_helper_id, p_event_id);

  return jsonb_build_object('helper', h.title, 'performed', performed);
end;
$$;

grant execute on function run_booking_helper(uuid, uuid) to authenticated;
grant execute on function render_merge_tags(uuid, text) to authenticated;

-- ============ DAILY STATUS RUNNER ============
create or replace function run_daily_status_actions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  total int := 0;
  n int;
begin
  for a in select * from daily_status_actions where is_active
  loop
    if a.trigger_type = 'event_date_passed' then
      update events set status_id = a.to_status_id
        where status_id = a.from_status_id
          and event_date is not null and event_date < current_date;
    elsif a.trigger_type = 'contract_due_passed' then
      update events set status_id = a.to_status_id
        where status_id = a.from_status_id
          and contract_due_date is not null and contract_due_date < current_date;
    end if;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return jsonb_build_object('events_updated', total, 'ran_at', now());
end;
$$;

grant execute on function run_daily_status_actions() to authenticated;

-- Nightly schedule at 09:00 UTC ≈ 4–5 AM ET (mirrors DJEP's 4 AM CT run).
-- pg_cron is pre-installed on Supabase; enable it under Database → Extensions if this errors.
create extension if not exists pg_cron;
select cron.schedule('xos-daily-status-actions', '0 9 * * *', 'select run_daily_status_actions()');

-- ============ SEED: starter email templates (placeholder copy — replace with your real DJEP templates) ============
insert into email_templates (group_name, name, subject, body_html) values
  ('BOOKING AGREEMENT', 'Booking Agreement',
   'Xpress Entertainment Booking Agreement — <event_type> on <event_date_long>',
   '<p>Hi <first_name>,</p><p>Your booking agreement for your <event_type> on <event_date_long> at <venue_name> is ready. Package: <package_name>. Total: <total_fee>, deposit <deposit_value>.</p><p>— Xpress Entertainment</p>'),
  ('BOOKED', 'Booking Confirmation',
   'Your <event_type> Entertainment has been Booked!',
   '<p>Hi <first_name>,</p><p>You are officially booked for <event_date_long> at <venue_name>! Balance due: <balance_due>.</p><p>Welcome to the Xpress Entertainment family!</p>'),
  ('LEADS', 'Checking In',
   'Just wanted to check in with you <first_name>',
   '<p>Hi <first_name>,</p><p>Checking in about your <event_type>. We are <event_date_countdown> days out — let''s lock in your date!</p>'),
  ('BOOKED', 'We''re Alive — 30 Days',
   '30 Days to Party Time! Let''s Lock In Your <event_type> Vibes!',
   '<p>Hi <first_name>,</p><p>Your <event_type> is only <event_date_countdown> days away! Time to finalize music and details.</p>');

-- ============ SEED: starter booking helpers wired to those templates ============
insert into booking_helpers (title, button_text, button_bg, button_fg, position, hide_if_already_ran, actions)
select
  'Send Contract', 'Send Contract', '#1B7E2C', '#FFFFFF', 1, false,
  jsonb_build_array(
    jsonb_build_object('type','set_status','status_id',(select id from event_statuses where name='Contract Sent')::text),
    jsonb_build_object('type','set_date','field','contract_sent_date','value','today'),
    jsonb_build_object('type','set_date','field','contract_due_date','value','+7'),
    jsonb_build_object('type','send_email','template_id',(select id from email_templates where name='Booking Agreement')::text,'to','client'),
    jsonb_build_object('type','add_note','body','Contract sent — due in 7 days.')
  );

insert into booking_helpers (title, button_text, button_bg, button_fg, position, hide_if_already_ran, actions)
select
  'Confirm Booking (WILL EMAIL CLIENT)', 'Confirm Booking (WILL EMAIL CLIENT)', '#F7FF00', '#000000', 2, true,
  jsonb_build_array(
    jsonb_build_object('type','set_status','status_id',(select id from event_statuses where name='Booked')::text),
    jsonb_build_object('type','send_email','template_id',(select id from email_templates where name='Booking Confirmation')::text,'to','client'),
    jsonb_build_object('type','add_note','body','Booking confirmed; confirmation email sent.')
  );

insert into booking_helpers (title, button_text, button_bg, button_fg, position, hide_if_already_ran, actions)
select
  'BOOKED EV', 'BOOKED EV', '#1B7E2C', '#FFFFFF', 3, false,
  jsonb_build_array(
    jsonb_build_object('type','set_status','status_id',(select id from event_statuses where name='Booked EV')::text),
    jsonb_build_object('type','add_note','body','Marked Booked EV.')
  );

insert into booking_helpers (title, button_text, button_bg, button_fg, position, hide_if_already_ran, actions)
select
  'Active Lead', 'Active Lead', '#FFF399', '#000000', 4, false,
  jsonb_build_array(
    jsonb_build_object('type','set_status','status_id',(select id from event_statuses where name='Active Lead')::text),
    jsonb_build_object('type','send_email','template_id',(select id from email_templates where name='Checking In')::text,'to','client')
  );

insert into booking_helpers (title, button_text, button_bg, button_fg, position, hide_if_already_ran, actions)
select
  'GHOSTED', 'GHOSTED', '#FF0000', '#FFFFFF', 5, false,
  jsonb_build_array(
    jsonb_build_object('type','set_status','status_id',(select id from event_statuses where name='Ghost Lead')::text),
    jsonb_build_object('type','add_note','body','Client unresponsive — moved to Ghost Lead.')
  );
