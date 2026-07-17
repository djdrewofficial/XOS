-- Dedicated Payment Reminders — due-date-aware email + SMS reminders per
-- installment. The generic run_scheduled_emails() engine can only anchor on a
-- single event-level date, fires once per (template, event), and is email-only,
-- so it can't do "3 days before THIS installment is due" or "SMS if 1 day late".
-- This is a separate evaluator that iterates unpaid scheduled_payments.

-- Reminder rules: fire N days before/after a payment's due date.
create table if not exists payment_reminder_rules (
  id                uuid primary key default gen_random_uuid(),
  label             text not null,
  offset_days       int  not null,            -- <0 before due, 0 on due, >0 after (late)
  send_email        boolean not null default true,
  email_template_id uuid references email_templates(id) on delete set null,
  send_sms          boolean not null default false,
  sms_template_id   uuid references email_templates(id) on delete set null,
  is_active         boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One send per (installment, rule) — dedupe so a reminder never repeats.
create table if not exists payment_reminder_sends (
  id                   uuid primary key default gen_random_uuid(),
  scheduled_payment_id uuid not null references scheduled_payments(id) on delete cascade,
  rule_id              uuid not null references payment_reminder_rules(id) on delete cascade,
  sent_at              timestamptz not null default now(),
  unique (scheduled_payment_id, rule_id)
);
create index if not exists prs_sp_idx on payment_reminder_sends(scheduled_payment_id);

alter table payment_reminder_rules enable row level security;
alter table payment_reminder_sends enable row level security;
do $$ begin
  create policy "staff manage payment reminder rules" on payment_reminder_rules
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read payment reminder sends" on payment_reminder_sends
    for select to authenticated using (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Engine: for each active rule, find unpaid installments whose due_date+offset is
-- today (company tz), and queue the rule's email/SMS. Stops once the installment
-- (or the whole event) is paid; deduped per (installment, rule).
create or replace function run_payment_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  v_today date;
  -- base URL for the pay link inside SMS (SQL can't read NEXT_PUBLIC_APP_URL).
  v_base text := 'https://xos.xpressdjs.com';
  r record;
  sp record;
  t_email record;
  t_sms record;
  v_sender jsonb;
  v_pay_link text;
  qmail int := 0;
  qsms int := 0;
begin
  select coalesce(timezone, 'America/New_York') into tz from company_settings where id = true;
  v_today := (now() at time zone tz)::date;

  for r in select * from payment_reminder_rules where is_active loop
    for sp in
      select s.id as sp_id, s.event_id, s.amount, s.due_date,
             e.pay_token, e.client_id,
             c.email as client_email, c.cell_phone as client_cell
      from scheduled_payments s
      join events e on e.id = s.event_id and e.archived_at is null
      left join clients c on c.id = e.client_id
      where s.due_date is not null
        and s.due_date + r.offset_days = v_today
        and not exists (
          select 1 from payments p where p.scheduled_payment_id = s.id and p.status = 'approved')
        and coalesce((select sum(amount) from payments p where p.event_id = e.id and p.status = 'approved'), 0)
            < coalesce((select sum(amount) from scheduled_payments s2 where s2.event_id = e.id), 0)
        and not exists (
          select 1 from payment_reminder_sends x where x.scheduled_payment_id = s.id and x.rule_id = r.id)
    loop
      v_pay_link := v_base || '/welcome/' || sp.pay_token;

      if r.send_email and r.email_template_id is not null
         and sp.client_email is not null and sp.client_email <> '' then
        select subject, body_html into t_email from email_templates where id = r.email_template_id and is_active;
        if found then
          v_sender := resolve_sender(sp.event_id, 'company');
          insert into email_log (event_id, client_id, template_id, to_address,
                                 from_name, from_address, reply_to, subject, body_html, status)
          values (sp.event_id, sp.client_id, r.email_template_id, sp.client_email,
                  v_sender->>'name', v_sender->>'email', v_sender->>'reply_to',
                  render_merge_tags(sp.event_id, t_email.subject),
                  replace(render_merge_tags(sp.event_id, t_email.body_html), '<pay_link>', v_pay_link),
                  'queued');
          qmail := qmail + 1;
        end if;
      end if;

      if r.send_sms and r.sms_template_id is not null
         and sp.client_cell is not null and sp.client_cell <> '' then
        select body_html into t_sms from email_templates where id = r.sms_template_id and is_active and is_sms;
        if found then
          -- resolve <pay_link> BEFORE stripping HTML (the strip would eat the tag)
          insert into sms_log (event_id, client_id, to_number, body, status)
          values (sp.event_id, sp.client_id, sp.client_cell,
                  xos_html_to_sms(replace(render_merge_tags(sp.event_id, t_sms.body_html), '<pay_link>', v_pay_link)),
                  'queued');
          qsms := qsms + 1;
        end if;
      end if;

      insert into payment_reminder_sends (scheduled_payment_id, rule_id)
      values (sp.sp_id, r.id) on conflict do nothing;
    end loop;
  end loop;

  return jsonb_build_object('emails', qmail, 'texts', qsms, 'ran_at', now());
end;
$$;

grant execute on function run_payment_reminders() to authenticated;

-- Run daily at 13:00 UTC (~8-9am ET). Queued rows drain via the send-outbox cron.
do $$ begin
  perform cron.schedule('xos-payment-reminders', '0 13 * * *', 'select run_payment_reminders()');
exception when others then null; end $$;

-- ---- Seed default templates + the proposed cadence -----------------------
do $seed$
declare
  v_up uuid; v_due uuid; v_late uuid; v_late_sms uuid;
begin
  select id into v_up from email_templates where name = 'Payment Reminder — Upcoming';
  if v_up is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Payment Reminder — Upcoming', 'PAYMENT REMINDERS',
      'A friendly reminder about your upcoming payment',
      $b$<p>Hi <first_name>,</p>
<p>Just a friendly heads-up — your next payment for your event on <event_date_long> is coming up soon.</p>
<p>Your current balance is <strong><balance_due></strong>. You can take care of it anytime using the button below:</p>
<payment_button>
<p>Thanks so much — we can't wait to celebrate with you!</p>
<p>— The Xpress Entertainment Team</p>$b$, true, false)
    returning id into v_up;
  end if;

  select id into v_due from email_templates where name = 'Payment Reminder — Due Today';
  if v_due is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Payment Reminder — Due Today', 'PAYMENT REMINDERS',
      'Your payment is due today',
      $b$<p>Hi <first_name>,</p>
<p>This is a reminder that a payment for your event on <event_date_long> is due today.</p>
<p>Your current balance is <strong><balance_due></strong>. You can pay securely here:</p>
<payment_button>
<p>Thank you!</p>
<p>— The Xpress Entertainment Team</p>$b$, true, false)
    returning id into v_due;
  end if;

  select id into v_late from email_templates where name = 'Payment Reminder — Past Due';
  if v_late is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Payment Reminder — Past Due', 'PAYMENT REMINDERS',
      'Your payment is now past due',
      $b$<p>Hi <first_name>,</p>
<p>We noticed a payment for your event on <event_date_long> is now past due. Your balance is <strong><balance_due></strong>.</p>
<p>Please take a moment to bring your account current:</p>
<payment_button>
<p>If you've already paid or need to talk through options, just reply and we'll help.</p>
<p>— The Xpress Entertainment Team</p>$b$, true, false)
    returning id into v_late;
  end if;

  select id into v_late_sms from email_templates where name = 'Payment Reminder — Past Due (SMS)';
  if v_late_sms is null then
    insert into email_templates (name, group_name, subject, body_html, is_active, is_sms)
    values ('Payment Reminder — Past Due (SMS)', 'PAYMENT REMINDERS', '',
      $b$Hi <first_name>, this is Xpress Entertainment — your balance of <balance_due> for your event on <event_date_long> is now past due. You can pay here: <pay_link>. Thank you!$b$,
      true, true)
    returning id into v_late_sms;
  end if;

  -- rules ship INACTIVE — staff review the copy, then switch them on so
  -- reminders never go to real clients with un-reviewed templates (and so they
  -- don't double up with any existing scheduled-email reminders).
  if not exists (select 1 from payment_reminder_rules) then
    insert into payment_reminder_rules (label, offset_days, send_email, email_template_id, send_sms, sms_template_id, is_active, sort_order) values
      ('7 days before due', -7, true, v_up,   false, null,       false, 0),
      ('On the due date',    0, true, v_due,  false, null,       false, 1),
      ('1 day past due',     1, true, v_late, true,  v_late_sms, false, 2),
      ('7 days past due',    7, true, v_late, false, null,       false, 3);
  end if;
end $seed$;
