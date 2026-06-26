-- 00109_email_sending_limits.sql
-- Client-send guardrails for the scheduled-email engine:
--   1. Allowed send window (quiet hours) — only queue scheduled emails when the
--      current company-local time is inside [email_send_window_start, _end].
--   2. Holiday blackout dates — never queue scheduled emails on these dates.
-- Both are global to the scheduler (run_scheduled_emails) and configured in
-- Settings → Email → Sending Settings.

alter table company_settings
  add column if not exists email_send_window_start time,
  add column if not exists email_send_window_end time;

create table if not exists email_blackout_dates (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  label text,
  created_at timestamptz not null default now()
);
alter table email_blackout_dates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'email_blackout_dates' and policyname = 'authenticated full access') then
    create policy "authenticated full access" on email_blackout_dates for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ============ SCHEDULED-EMAIL ENGINE (re-created: + send-window + holiday guards) ============
create or replace function run_scheduled_emails()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  v_win_start time;
  v_win_end time;
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
  queued int := 0;
  events_hit int := 0;
begin
  select coalesce(timezone, 'America/New_York'), email_send_window_start, email_send_window_end
    into tz, v_win_start, v_win_end
  from company_settings where id = true;
  v_today := (now() at time zone tz)::date;
  v_time  := (now() at time zone tz)::time;

  -- ===== global send limits =====
  -- Holiday blackout: skip the whole run on configured dates.
  if exists (select 1 from email_blackout_dates where day = v_today) then
    return jsonb_build_object('events', 0, 'queued', 0, 'skipped', 'holiday', 'ran_at', now());
  end if;
  -- Quiet hours: only queue inside the allowed window (when one is set).
  if v_win_start is not null and v_win_end is not null
     and not (v_time >= v_win_start and v_time <= v_win_end) then
    return jsonb_build_object('events', 0, 'queued', 0, 'skipped', 'outside_window', 'ran_at', now());
  end if;

  for t in
    select * from email_templates
    where is_active and schedule_enabled and schedule_days is not null
  loop
    if t.schedule_send_time > v_time then continue; end if;  -- not time yet today

    for e in select * from events
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

      if exists (select 1 from scheduled_email_runs r
                 where r.template_id = t.id and r.event_id = e.id and r.target_date = v_target) then
        continue;
      end if;

      -- ===== event parameter matching (must match ALL) =====
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

      -- ===== recipients =====
      v_from_spec := case t.schedule_from when 'master_admin' then 'company' else t.schedule_from end;
      v_sender := resolve_sender(e.id, v_from_spec);
      v_subject := render_merge_tags(e.id, t.subject);
      v_body := render_merge_tags(e.id, t.body_html);
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
          select vn.email from event_vendors ev join vendors vn on vn.id = ev.vendor_id
          where ev.event_id = e.id and vn.email is not null and vn.email <> ''
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

      insert into scheduled_email_runs (template_id, event_id, target_date)
      values (t.id, e.id, v_target)
      on conflict do nothing;
      events_hit := events_hit + 1;

      if t.sched_set_status_id is not null then
        update events set status_id = t.sched_set_status_id where id = e.id;
      end if;
      if t.sched_run_helper_id is not null then
        begin perform run_booking_helper(t.sched_run_helper_id, e.id);
        exception when others then null; end;
      end if;

    end loop;
  end loop;

  return jsonb_build_object('events', events_hit, 'queued', queued, 'ran_at', now());
end;
$$;

grant execute on function run_scheduled_emails() to authenticated;
