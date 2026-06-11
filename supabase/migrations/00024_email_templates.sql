-- XOS — Email Templates (DJEP-parity): Content / Settings / Scheduling / Visibility
-- Adds the full template field set, a time-of-day scheduled-email engine (sends at
-- each template's own time, not one nightly batch), and merge-tag handling that
-- survives a WYSIWYG editor (which HTML-escapes <tags> to &lt;tags&gt;).

-- ============ COMPANY: timezone + email signature ============
alter table company_settings add column if not exists timezone text not null default 'America/New_York';
alter table company_settings add column if not exists email_signature_html text not null default '';

-- ============ EMAIL TEMPLATE FIELDS ============
-- Settings tab
alter table email_templates add column if not exists display_name text;
alter table email_templates add column if not exists autofill_send_to text[] not null default '{}';      -- client, employees, salesperson, administrator, planning_clients, vendors, venue, logged_employee
alter table email_templates add column if not exists autofill_specific_email text;
alter table email_templates add column if not exists include_signature boolean not null default false;
alter table email_templates add column if not exists after_set_status_id uuid references event_statuses(id);
alter table email_templates add column if not exists after_run_helper_id uuid references booking_helpers(id);

-- Scheduling tab
alter table email_templates add column if not exists schedule_enabled boolean not null default false;
alter table email_templates add column if not exists schedule_days int;
alter table email_templates add column if not exists schedule_direction text not null default 'before' check (schedule_direction in ('before','after'));
alter table email_templates add column if not exists schedule_anchor text not null default 'event_date';   -- event_date, initial_contact_date, contract_sent_date, contract_due_date, contract_signed_date, quote_sent_date, booked_date
alter table email_templates add column if not exists schedule_send_time time not null default '09:00';
alter table email_templates add column if not exists sched_status_ids uuid[] not null default '{}';
alter table email_templates add column if not exists sched_event_type_ids uuid[] not null default '{}';
alter table email_templates add column if not exists sched_packages_mode text not null default 'all';      -- all | selected
alter table email_templates add column if not exists sched_package_ids uuid[] not null default '{}';
alter table email_templates add column if not exists sched_addons_mode text not null default 'all';        -- all | assigned | not_assigned
alter table email_templates add column if not exists sched_addon_ids uuid[] not null default '{}';
alter table email_templates add column if not exists sched_payments text not null default 'any';           -- any | none | partial | paid_full
alter table email_templates add column if not exists sched_salesperson_mode text not null default 'any';   -- any | selected
alter table email_templates add column if not exists sched_salesperson_ids uuid[] not null default '{}';
alter table email_templates add column if not exists sched_employee_mode text not null default 'any';      -- any | selected
alter table email_templates add column if not exists sched_employee_ids uuid[] not null default '{}';
alter table email_templates add column if not exists schedule_from text not null default 'company';        -- company | salesperson | primary_dj | master_admin
alter table email_templates add column if not exists sched_send_to text[] not null default '{client}';     -- client, planning_clients, venue, vendors, all_employees, primary_employee, unconfirmed_employees, master_admin, salesperson
alter table email_templates add column if not exists sched_exclude_declined boolean not null default false;
alter table email_templates add column if not exists sched_also_send_to text;
alter table email_templates add column if not exists sched_set_status_id uuid references event_statuses(id);
alter table email_templates add column if not exists sched_run_helper_id uuid references booking_helpers(id);

-- Visibility tab
alter table email_templates add column if not exists vis_status_ids uuid[] not null default '{}';
alter table email_templates add column if not exists vis_event_type_ids uuid[] not null default '{}';
alter table email_templates add column if not exists vis_packages_mode text not null default 'all';
alter table email_templates add column if not exists vis_package_ids uuid[] not null default '{}';
alter table email_templates add column if not exists vis_addons_mode text not null default 'all';
alter table email_templates add column if not exists vis_addon_ids uuid[] not null default '{}';
alter table email_templates add column if not exists employee_visibility text not null default 'admins_salespeople'; -- admins_salespeople | all
alter table email_templates add column if not exists is_inbox_reply boolean not null default false;
alter table email_templates add column if not exists is_vendor_template boolean not null default false;
alter table email_templates add column if not exists is_venue_template boolean not null default false;

-- ============ MERGE TAG RENDERER (re-created) ============
-- Adds: (1) a pre-pass that decodes &lt; / &gt; so merge tags typed in the WYSIWYG
-- editor (stored escaped) still match; (2) <company_email_signature> + <email_signature>.
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
  cs record;
  out_text text := coalesce(p_template, '');
  v_total numeric := 0;
  v_paid numeric := 0;
  v_addons numeric := 0;
  v_countdown int;
begin
  -- decode escaped angle brackets so <merge_tags> from the HTML editor match
  out_text := replace(out_text, '&lt;', '<');
  out_text := replace(out_text, '&gt;', '>');

  select * into e from events where id = p_event_id;
  if not found then return out_text; end if;

  select * into c from clients where id = e.client_id;
  select * into v from venues where id = e.venue_id;
  select * into p from packages where id = e.package_id;
  select * into cs from company_settings where id = true;

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
  out_text := replace(out_text, '<company_name>', coalesce(cs.company_name, 'Xpress Entertainment'));
  out_text := replace(out_text, '<company_email_signature>', coalesce(cs.email_signature_html, ''));
  out_text := replace(out_text, '<email_signature>', coalesce(cs.email_signature_html, ''));
  out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));

  return out_text;
end;
$$;

grant execute on function render_merge_tags(uuid, text) to authenticated;

-- ============ SCHEDULED-EMAIL DEDUPE ============
create table if not exists scheduled_email_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references email_templates(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  target_date date not null,
  sent_at timestamptz not null default now(),
  unique (template_id, event_id, target_date)
);
alter table scheduled_email_runs enable row level security;
create policy "authenticated full access" on scheduled_email_runs for all to authenticated using (true) with check (true);

-- ============ SCHEDULED-EMAIL ENGINE ============
-- Run frequently (every 15 min). For each enabled template it finds events whose
-- anchor date ± N days is today (in the company timezone) and whose local time has
-- reached the template's send time, matches ALL event parameters, and hasn't sent
-- yet — then queues the email(s) to the outbox and applies any update-event actions.
create or replace function run_scheduled_emails()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
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
  select coalesce(timezone, 'America/New_York') into tz from company_settings where id = true;
  v_today := (now() at time zone tz)::date;
  v_time  := (now() at time zone tz)::time;

  for t in
    select * from email_templates
    where is_active and schedule_enabled and schedule_days is not null
  loop
    if t.schedule_send_time > v_time then continue; end if;  -- not time yet today

    for e in select * from events
    loop
      -- anchor date
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

      -- already sent for this target date?
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

      if 'client' = any (t.sched_send_to) then
        v_recipients := v_recipients || array(select email from clients where id = e.client_id and email is not null and email <> '');
      end if;
      if 'planning_clients' = any (t.sched_send_to) then
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
          where ev.event_id = e.id and vn.email is not null and vn.email <> '');
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

      -- queue one row per distinct recipient
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

      -- update-event actions
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

-- run every 15 minutes (pg_cron is pre-installed on Supabase; enable under Database → Extensions if this errors)
create extension if not exists pg_cron;
select cron.schedule('xos-scheduled-emails', '*/15 * * * *', 'select run_scheduled_emails()');
