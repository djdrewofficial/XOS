-- Per-event control of a scheduled email or text.
--
-- run_scheduled_emails() already refuses to queue a template/event/day once a
-- scheduled_email_runs row exists. That row is now the staff action record:
--   sent        the scheduler queued it (every row that existed before this)
--   pending     staff edited the subject/body for this event; still waiting to send
--   skipped     staff skipped it; the scheduler will not send it
--   marked_sent staff recorded that it already went out (DJEP, a manual send, …)
-- Undo skip deletes the row, or sets it back to pending when an edit is attached.
-- The edited subject/body are rendered with render_merge_tags at send time, same
-- as the shared template, and the email still carries template_id so the outbox
-- fills quote/payment/document tags and the branded shell the way it always has.
--
-- SMS templates (email_templates.is_sms) queue into sms_log instead of email_log.
-- None are schedule-enabled today; leaving them on the email path would mail the
-- text body to email addresses the moment one was turned on. Vendor email looks
-- up vendor_contacts — the vendors table has no email column, so the old
-- vendors.email reference would abort the whole cron tick.

alter table scheduled_email_runs
  add column if not exists status text not null default 'sent',
  add column if not exists acted_by uuid,
  add column if not exists acted_by_name text,
  add column if not exists acted_at timestamptz,
  add column if not exists override_subject text,
  add column if not exists override_body_html text,
  add column if not exists override_is_raw_html boolean,
  add column if not exists edited_by uuid,
  add column if not exists edited_by_name text,
  add column if not exists edited_at timestamptz;

alter table scheduled_email_runs drop constraint if exists scheduled_email_runs_status_check;
alter table scheduled_email_runs
  add constraint scheduled_email_runs_status_check
  check (status in ('pending', 'sent', 'skipped', 'marked_sent'));

-- sent_at is the moment the scheduler queued the message. A skip, an edit, or
-- a "marked sent" row has no send, so the column can be empty.
alter table scheduled_email_runs alter column sent_at drop not null;
alter table scheduled_email_runs alter column sent_at drop default;

create index if not exists scheduled_email_runs_event_idx
  on scheduled_email_runs (event_id, target_date);

comment on column scheduled_email_runs.status is
  'sent = scheduler queued it; pending = per-event edit waiting to send; skipped = staff skipped this event; marked_sent = staff recorded it was already sent.';
comment on column scheduled_email_runs.acted_by is 'auth.users id of the staff member who skipped or marked this sent.';
comment on column scheduled_email_runs.override_body_html is 'Per-event body. Null uses the shared template. Merge tags are resolved at send time.';

-- Replace the live scheduler. Grants stay as they are (authenticated cannot
-- execute this; service_role and the owner can). CREATE OR REPLACE keeps them.
create or replace function public.run_scheduled_emails()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  v_win_start time;
  v_win_end time;
  v_in_window boolean;
  t record;
  e record;
  v_anchor date;
  v_target date;
  v_today date;
  v_time time;
  v_total numeric;
  v_paid numeric;
  v_addons numeric;
  v_sender jsonb;
  v_from_spec text;
  v_subject text;
  v_body text;
  v_recipients text[];
  v_addr text;
  v_run_status text;
  v_override_subject text;
  v_override_body text;
  v_recips jsonb;
  v_recip record;
  queued int := 0;
  events_hit int := 0;
begin
  perform pg_advisory_xact_lock(4771001);
  select coalesce(timezone, 'America/New_York'), email_send_window_start, email_send_window_end
    into tz, v_win_start, v_win_end
  from company_settings where id = true;
  v_today := (now() at time zone tz)::date;
  v_time  := (now() at time zone tz)::time;

  if exists (select 1 from email_blackout_dates where day = v_today) then
    return jsonb_build_object('events', 0, 'queued', 0, 'skipped', 'holiday', 'ran_at', now());
  end if;
  -- quiet-hours window (supports overnight windows where start > end)
  if v_win_start is not null and v_win_end is not null then
    v_in_window := case
      when v_win_start <= v_win_end then (v_time >= v_win_start and v_time <= v_win_end)
      else (v_time >= v_win_start or v_time <= v_win_end)
    end;
    if not v_in_window then
      return jsonb_build_object('events', 0, 'queued', 0, 'skipped', 'outside_window', 'ran_at', now());
    end if;
  end if;

  for t in
    select * from email_templates
    where is_active and schedule_enabled and schedule_days is not null
  loop
    if t.schedule_send_time > v_time then continue; end if;

    for e in select * from events where archived_at is null
    loop
      v_anchor := case t.schedule_anchor
        when 'event_date' then e.event_date
        when 'initial_contact_date' then e.initial_contact_date
        when 'contract_sent_date' then e.contract_sent_date
        when 'contract_due_date' then e.contract_due_date
        when 'contract_signed_date' then e.contract_signed_date
        when 'quote_sent_date' then e.quote_sent_date
        when 'booked_date' then e.booked_date
        else e.event_date end;
      if v_anchor is null then continue; end if;

      v_target := case t.schedule_direction
        when 'before' then v_anchor - t.schedule_days
        else v_anchor + t.schedule_days end;
      if v_target <> v_today then continue; end if;

      -- A row means this occurrence was already handled, unless staff only
      -- saved an edit (pending) and it still needs to go out.
      v_run_status := null;
      v_override_subject := null;
      v_override_body := null;
      select r.status, r.override_subject, r.override_body_html
        into v_run_status, v_override_subject, v_override_body
      from scheduled_email_runs r
      where r.template_id = t.id and r.event_id = e.id and r.target_date = v_target;
      if found and v_run_status in ('sent', 'skipped', 'marked_sent') then
        continue;
      end if;

      if array_length(t.sched_status_ids,1) is not null
         and not (e.status_id = any (t.sched_status_ids)) then continue; end if;
      if array_length(t.sched_event_type_ids,1) is not null
         and not (e.event_type_id = any (t.sched_event_type_ids)) then continue; end if;
      if t.sched_packages_mode = 'selected'
         and not (e.package_id = any (t.sched_package_ids)) then continue; end if;
      if t.sched_addons_mode = 'assigned'
         and not exists (select 1 from event_addons ea where ea.event_id = e.id and ea.addon_id = any (t.sched_addon_ids)) then continue; end if;
      if t.sched_addons_mode = 'not_assigned'
         and exists (select 1 from event_addons ea where ea.event_id = e.id and ea.addon_id = any (t.sched_addon_ids)) then continue; end if;
      if t.sched_salesperson_mode = 'selected'
         and not (e.salesperson_id = any (t.sched_salesperson_ids)) then continue; end if;
      if t.sched_employee_mode = 'selected'
         and not exists (select 1 from event_staff es where es.event_id = e.id and es.employee_id = any (t.sched_employee_ids)) then continue; end if;

      if t.sched_payments <> 'any' then
        select coalesce(sum(quantity * coalesce(ea.price_override, a.default_price)),0) into v_addons
          from event_addons ea join addons a on a.id = ea.addon_id where ea.event_id = e.id;
        v_total := coalesce(e.package_price_override, (select default_price from packages where id = e.package_id), 0)
                   + v_addons + e.overtime_fee + e.travel_fee - e.discount1_amount - e.discount2_amount;
        select coalesce(sum(amount),0) into v_paid from payments where event_id = e.id;
        if t.sched_payments = 'none' and v_paid <> 0 then continue; end if;
        if t.sched_payments = 'partial' and not (v_paid > 0 and v_paid < v_total) then continue; end if;
        if t.sched_payments = 'paid_full' and v_paid < v_total then continue; end if;
      end if;

      if coalesce(t.is_sms, false) then
        -- Tags first, then strip HTML. <first_name> must be substituted before
        -- anything that looks like a tag is removed. Same order as send_sms.
        v_body := xos_html_to_sms(render_merge_tags(e.id, coalesce(v_override_body, t.body_html)));
        v_recips := '[]'::jsonb;

        if 'primary_client' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', c.cell_phone, 'client_id', c.id))
            from clients c
            where c.id = e.client_id and c.cell_phone is not null and c.cell_phone <> ''
          ), '[]'::jsonb);
        end if;
        if 'additional_clients' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', cl.cell_phone, 'client_id', cl.id))
            from event_clients ec
            join clients cl on cl.id = ec.client_id
            where ec.event_id = e.id and coalesce(ec.is_primary, false) = false
              and cl.cell_phone is not null and cl.cell_phone <> ''
          ), '[]'::jsonb);
        end if;
        if 'venue' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', v.phone, 'client_id', null))
            from venues v
            where v.id = e.venue_id and v.phone is not null and v.phone <> ''
          ), '[]'::jsonb);
        end if;
        if 'vendors' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', vc.phone, 'client_id', null))
            from event_vendors ev
            join vendors vn on vn.id = ev.vendor_id
            join vendor_contacts vc on vc.vendor_id = vn.id
            where ev.event_id = e.id and vc.phone is not null and vc.phone <> ''
              and (array_length(t.sched_vendor_category_ids,1) is null
                   or vn.category_id = any (t.sched_vendor_category_ids))
          ), '[]'::jsonb);
        end if;
        if 'salesperson' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', em.phone, 'client_id', null))
            from employees em
            where em.id = e.salesperson_id and em.phone is not null and em.phone <> ''
          ), '[]'::jsonb);
        end if;
        if 'all_employees' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', em.phone, 'client_id', null))
            from event_staff es
            join employees em on em.id = es.employee_id
            where es.event_id = e.id and em.phone is not null and em.phone <> ''
              and (not t.sched_exclude_declined or es.declined_at is null)
          ), '[]'::jsonb);
        end if;
        if 'primary_employee' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_build_array(jsonb_build_object('phone', em.phone, 'client_id', null))
            from event_staff es
            join employees em on em.id = es.employee_id
            where es.event_id = e.id and em.phone is not null and em.phone <> ''
            order by (es.role ilike '%dj%') desc, es.id
            limit 1
          ), '[]'::jsonb);
        end if;
        if 'unconfirmed_employees' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', em.phone, 'client_id', null))
            from event_staff es
            join employees em on em.id = es.employee_id
            where es.event_id = e.id and em.phone is not null and em.phone <> ''
              and es.confirmed_at is null and es.declined_at is null
          ), '[]'::jsonb);
        end if;
        if 'master_admin' = any (t.sched_send_to) then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', em.phone, 'client_id', null))
            from employees em
            where em.permission_tier = 'master_admin' and em.is_active
              and em.phone is not null and em.phone <> ''
          ), '[]'::jsonb);
        end if;
        if coalesce(t.sched_also_send_to, '') <> '' then
          v_recips := v_recips || coalesce((
            select jsonb_agg(jsonb_build_object('phone', addr, 'client_id', null))
            from unnest(string_to_array(replace(render_merge_tags(e.id, t.sched_also_send_to), ' ', ''), ',')) as addr
            where addr is not null and addr <> ''
          ), '[]'::jsonb);
        end if;

        for v_recip in
          select distinct on (phone) phone, client_id
          from jsonb_to_recordset(v_recips) as x(phone text, client_id uuid)
          where phone is not null and phone <> ''
          order by phone, client_id nulls last
        loop
          insert into sms_log (event_id, client_id, to_number, body, status, is_marketing)
          values (e.id, v_recip.client_id, v_recip.phone, v_body, 'queued', coalesce(t.sms_marketing, false));
          queued := queued + 1;
        end loop;
      else
        v_from_spec := case t.schedule_from when 'master_admin' then 'company' else t.schedule_from end;
        v_sender := resolve_sender(e.id, v_from_spec);
        v_subject := render_merge_tags(e.id, coalesce(v_override_subject, t.subject));
        v_body := render_merge_tags(e.id, coalesce(v_override_body, t.body_html));
        v_recipients := '{}';

        if 'primary_client' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(select email from clients where id = e.client_id and email is not null and email <> '');
        end if;
        if 'additional_clients' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(
            select cl.email from event_clients ec join clients cl on cl.id = ec.client_id
            where ec.event_id = e.id and coalesce(ec.is_primary,false) = false and cl.email is not null and cl.email <> '');
        end if;
        if 'venue' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(select email from venues where id = e.venue_id and email is not null and email <> '');
        end if;
        if 'vendors' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(
            select distinct vc.email
            from event_vendors ev
            join vendors vn on vn.id = ev.vendor_id
            join vendor_contacts vc on vc.vendor_id = vn.id
            where ev.event_id = e.id and vc.email is not null and vc.email <> ''
              and (array_length(t.sched_vendor_category_ids,1) is null
                   or vn.category_id = any (t.sched_vendor_category_ids)));
        end if;
        if 'salesperson' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(select email from employees where id = e.salesperson_id and email is not null and email <> '');
        end if;
        if 'all_employees' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(
            select em.email from event_staff es join employees em on em.id = es.employee_id
            where es.event_id = e.id and em.email is not null and em.email <> ''
              and (not t.sched_exclude_declined or es.declined_at is null));
        end if;
        if 'primary_employee' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(
            select em.email from event_staff es join employees em on em.id = es.employee_id
            where es.event_id = e.id and em.email is not null and em.email <> ''
            order by (es.role ilike '%dj%') desc, es.id limit 1);
        end if;
        if 'unconfirmed_employees' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(
            select em.email from event_staff es join employees em on em.id = es.employee_id
            where es.event_id = e.id and em.email is not null and em.email <> ''
              and es.confirmed_at is null and es.declined_at is null);
        end if;
        if 'master_admin' = any (t.sched_send_to) then
          v_recipients := v_recipients || array(select from_email from company_settings where id = true);
        end if;
        if coalesce(t.sched_also_send_to,'') <> '' then
          v_recipients := v_recipients || string_to_array(replace(render_merge_tags(e.id, t.sched_also_send_to), ' ', ''), ',');
        end if;

        for v_addr in
          select distinct addr from unnest(v_recipients) as addr
          where addr is not null and addr <> ''
        loop
          insert into email_log (event_id, client_id, template_id, to_address,
                                 from_name, from_address, reply_to, subject, body_html, status)
          values (e.id, e.client_id, t.id, v_addr,
                  v_sender->>'name', v_sender->>'email', v_sender->>'reply_to',
                  v_subject, v_body, 'queued');
          queued := queued + 1;
        end loop;
      end if;

      insert into scheduled_email_runs (template_id, event_id, target_date, status, sent_at)
      values (t.id, e.id, v_target, 'sent', now())
      on conflict (template_id, event_id, target_date)
      do update set status = 'sent', sent_at = now()
      where scheduled_email_runs.status = 'pending';
      events_hit := events_hit + 1;

      if t.sched_set_status_id is not null then
        update events set status_id = t.sched_set_status_id where id = e.id;
      end if;
      if t.sched_run_helper_id is not null then
        begin perform run_booking_helper(t.sched_run_helper_id, e.id);
        exception when others then insert into event_logs (event_id, actor, action) values (e.id, 'system', 'Scheduled helper did not run: ' || sqlerrm); end;
      end if;

    end loop;
  end loop;

  return jsonb_build_object('events', events_hit, 'queued', queued, 'ran_at', now());
end;
$$;
