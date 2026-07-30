-- Point the payment-reminder <pay_link> (SMS) at the dedicated /pay page instead
-- of the /welcome "you're booked" page. Only the v_pay_link URL changes vs 00125.

create or replace function run_payment_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  v_today date;
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
      v_pay_link := v_base || '/pay/' || sp.pay_token;

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
