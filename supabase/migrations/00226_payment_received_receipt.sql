-- Payment Received receipt email + merge tags for the payment just recorded.
--
-- New tags (latest approved, non-deleted payment by paid_at desc):
--   <most_recent_payment_amount>           base amount credited to the balance
--   <most_recent_payment_method>           display method (PayPal, Zelle, ...)
--   <most_recent_payment_date>             long date of paid_at
--   <most_recent_payment_processing_fee>   card/PayPal service fee, or blank when $0
--   <most_recent_payment_fee_line>         "<br>Card service fee: <strong>$...</strong>" or blank
--   <balance_status>                      "Paid in full" when balance <= 0, else <balance_due>
--
-- processing_fee is NEVER added into payments_received / balance math - same as
-- every other balance reader (payInfo, Financials tab, render_merge_tags v_paid).
--
-- Seeds an English "Payment Received" template (email templates have no Spanish
-- locale column) and a booking helper wired to auto_on_payment=false so staff can
-- opt in later. Nothing auto-sends.

-- ---- helpers used by render_merge_tags + tests --------------------------------
create or replace function public.xos_format_payment_method(p_method text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_method, '') = '' then ''
    when p_method ~ '[A-Z]' then p_method
    when lower(p_method) = 'paypal' then 'PayPal'
    when lower(p_method) = 'card' then 'Card'
    when lower(p_method) = 'cash' then 'Cash'
    when lower(p_method) = 'check' then 'Check'
    when lower(p_method) = 'zelle' then 'Zelle'
    when lower(p_method) = 'venmo' then 'Venmo'
    when lower(p_method) = 'ach' then 'ACH'
    when lower(p_method) = 'other' then 'Other'
    else initcap(replace(p_method, '_', ' '))
  end;
$$;

create or replace function public.xos_payment_receipt_tags(p_event_id uuid)
returns table (
  amount text,
  method text,
  paid_date text,
  fee text,
  fee_line text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_fee numeric;
  v_fee_txt text;
begin
  select p.amount, p.method, p.paid_at, coalesce(p.processing_fee, 0) as processing_fee
    into r
  from payments p
  where p.event_id = p_event_id
    and p.status = 'approved'
    and p.deleted_at is null
  order by p.paid_at desc nulls last, p.created_at desc
  limit 1;

  if not found then
    amount := '';
    method := '';
    paid_date := '';
    fee := '';
    fee_line := '';
    return next;
    return;
  end if;

  v_fee := coalesce(r.processing_fee, 0);
  v_fee_txt := case when v_fee > 0 then to_char(v_fee, 'FM$999,999,990.00') else '' end;

  amount := to_char(coalesce(r.amount, 0), 'FM$999,999,990.00');
  method := xos_format_payment_method(r.method);
  paid_date := coalesce(to_char((r.paid_at at time zone 'America/New_York')::date, 'FMMonth FMDD, YYYY'), '');
  fee := v_fee_txt;
  fee_line := case
    when v_fee > 0 then '<br>Card service fee: <strong>' || v_fee_txt || '</strong>'
    else ''
  end;
  return next;
end;
$$;

create or replace function public.xos_balance_status(p_total numeric, p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_paid numeric := 0;
  v_bal numeric;
begin
  select coalesce(sum(amount), 0) into v_paid
  from payments
  where event_id = p_event_id
    and status = 'approved'
    and deleted_at is null;
  v_bal := coalesce(p_total, 0) - v_paid;
  if v_bal <= 0 then
    return 'Paid in full';
  end if;
  return to_char(v_bal, 'FM$999,999,990.00');
end;
$$;

revoke all on function public.xos_format_payment_method(text) from public;
revoke all on function public.xos_payment_receipt_tags(uuid) from public;
revoke all on function public.xos_balance_status(numeric, uuid) from public;
grant execute on function public.xos_format_payment_method(text) to authenticated, service_role;
grant execute on function public.xos_payment_receipt_tags(uuid) to authenticated, service_role;
grant execute on function public.xos_balance_status(numeric, uuid) to authenticated, service_role;

-- ---- picker rows (also keeps the unknown-tag stripper from deleting them) ----
insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values
  ('most_recent_payment_amount', 'Latest Payment Amount', 'Money',
   'Base amount of the most recent approved payment (excludes card service fee).', 'builtin', null, true, true),
  ('most_recent_payment_method', 'Latest Payment Method', 'Money',
   'Method of the most recent approved payment (PayPal, Zelle, Card, ...).', 'builtin', null, true, true),
  ('most_recent_payment_date', 'Latest Payment Date', 'Money',
   'Date of the most recent approved payment.', 'builtin', null, true, true),
  ('most_recent_payment_processing_fee', 'Latest Payment Card Fee', 'Money',
   'Card/PayPal service fee on the most recent payment, blank when none.', 'builtin', null, true, true),
  ('most_recent_payment_fee_line', 'Latest Payment Fee Line', 'Money',
   'Ready-to-drop HTML line for the card service fee, blank when none.', 'builtin', null, true, true),
  ('balance_status', 'Balance or Paid in Full', 'Money',
   'Remaining balance, or the words "Paid in full" when the balance is zero.', 'builtin', null, true, true)
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      source_type = 'builtin',
      is_builtin = true,
      is_active = true;

-- ---- patch render_merge_tags: receipt tags + balance_status --------------------
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<balance_due>', to_char(v_total - v_paid, 'FM$999,999,990.00'));$a$;
  addition text := $a$out_text := replace(out_text, '<balance_due>', to_char(v_total - v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<balance_status>',
    case when (v_total - v_paid) <= 0 then 'Paid in full'
         else to_char(v_total - v_paid, 'FM$999,999,990.00') end);
  -- Latest approved payment (fee is display-only; v_paid already excludes it).
  out_text := replace(out_text, '<most_recent_payment_amount>',
    coalesce((select t.amount from xos_payment_receipt_tags(e.id) t), ''));
  out_text := replace(out_text, '<most_recent_payment_method>',
    xos_html_escape(coalesce((select t.method from xos_payment_receipt_tags(e.id) t), '')));
  out_text := replace(out_text, '<most_recent_payment_date>',
    coalesce((select t.paid_date from xos_payment_receipt_tags(e.id) t), ''));
  out_text := replace(out_text, '<most_recent_payment_processing_fee>',
    coalesce((select t.fee from xos_payment_receipt_tags(e.id) t), ''));
  out_text := replace(out_text, '<most_recent_payment_fee_line>',
    coalesce((select t.fee_line from xos_payment_receipt_tags(e.id) t), ''));$a$;
begin
  if position('<most_recent_payment_amount>' in src) > 0 then
    return; -- already patched
  end if;
  if strpos(src, anchor) = 0 then
    raise exception 'render_merge_tags: <balance_due> anchor not found';
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: <balance_due> anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- Blank the new money tags for venue-paid / hide-financials events (00199).
-- Anchored on the payments_received + balance_due pair so we only touch the
-- early blanking pass, not the value-fill replaces added above.
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<payments_received>', '');
    out_text := replace(out_text, '<balance_due>', '');$a$;
  addition text := $a$out_text := replace(out_text, '<payments_received>', '');
    out_text := replace(out_text, '<balance_due>', '');
    out_text := replace(out_text, '<balance_status>', '');
    out_text := replace(out_text, '<most_recent_payment_amount>', '');
    out_text := replace(out_text, '<most_recent_payment_method>', '');
    out_text := replace(out_text, '<most_recent_payment_date>', '');
    out_text := replace(out_text, '<most_recent_payment_processing_fee>', '');
    out_text := replace(out_text, '<most_recent_payment_fee_line>', '');$a$;
begin
  if position(addition in src) > 0 then
    return; -- already patched
  end if;
  if position(anchor in src) = 0 then
    return; -- hide-financials not applied in this environment
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: hide-financials money blank anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- ---- seed email template (English only; no Spanish template column in XOS) ----
do $seed$
declare
  tpl_id uuid;
begin
  select id into tpl_id from email_templates where name = 'Payment Received' limit 1;
  if tpl_id is null then
    insert into email_templates (name, display_name, group_name, subject, body_html, is_active, is_sms, branded_shell)
    values (
      'Payment Received',
      'Payment Received',
      'PAYMENTS',
      'Payment received for <event_name>',
      $b$<p>Hi <first_name>,</p>
<p>Thank you! We received your payment for <event_name> on <event_date_long>.</p>
<p><strong>This payment</strong><br>
Amount: <strong><most_recent_payment_amount></strong><br>
Method: <strong><most_recent_payment_method></strong><br>
Date: <strong><most_recent_payment_date></strong>
<most_recent_payment_fee_line></p>
<p>Total paid so far: <strong><payments_received></strong><br>
Remaining balance: <strong><balance_status></strong></p>
<p>This is your receipt for your records. It relates to your booking agreement with us. If anything looks off, just reply to this email and we will sort it out.</p>
<p>With gratitude,<br>The Xpress Entertainment Team</p>$b$,
      true, false, true
    )
    returning id into tpl_id;
  end if;

  -- Helper offers the receipt for the payment-received trigger, but does NOT
  -- auto-send (auto_on_payment stays false until staff turns it on).
  if not exists (select 1 from booking_helpers where title = 'Send Payment Received Receipt') then
    insert into booking_helpers (
      title, description, button_text, button_bg, button_fg, position, is_active,
      hide_if_already_ran, auto_on_payment, actions
    ) values (
      'Send Payment Received Receipt',
      'Emails the Payment Received receipt to the client. Turn on "When a payment is received" under Automation only when you want it to send automatically.',
      'Send Payment Receipt',
      '#4B328E', '#FFFFFF',
      (select coalesce(max(position), 0) + 1 from booking_helpers),
      true,
      false,
      false,
      jsonb_build_array(
        jsonb_build_object(
          'type', 'send_email',
          'template_id', tpl_id::text,
          'to', 'client'
        )
      )
    );
  end if;
end
$seed$;
