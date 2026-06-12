-- XOS — Phase 3: after-sign automation.
-- A document template can point at a booking helper; when a client signs a
-- document generated from it, signDocument() runs that helper (status change,
-- confirmation email, retainer request — any helper actions). Seeds a
-- "Retainer Payment Request" email + an "After Sign — Booking Agreement"
-- helper and wires it to the Booking Agreement document template.

-- ============ TEMPLATE → HELPER LINK ============
alter table document_templates
  add column if not exists after_sign_helper_id uuid references booking_helpers(id) on delete set null;

-- ============ MERGE TAGS v5: <retainer_amount> / <retainer_due_date> ============
-- Retainer = scheduled payment #1 (falls back to the event's deposit_value).
-- Due date falls back to "upon signing" so retainer emails read naturally.
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
  sp record;
  out_text text := coalesce(p_template, '');
  v_total numeric := 0;
  v_paid numeric := 0;
  v_addons numeric := 0;
  v_countdown int;
  v_overtime numeric := 0;
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
  select * into sp from scheduled_payments where event_id = e.id order by seq limit 1;

  select coalesce(sum(quantity * coalesce(ea.price_override, ea.price_locked, a.default_price)), 0)
    into v_addons
  from event_addons ea join addons a on a.id = ea.addon_id
  where ea.event_id = e.id;

  v_total := coalesce(e.package_price_override, e.package_price_locked, p.default_price, 0)
             + v_addons + e.overtime_fee + e.travel_fee
             + coalesce(v.setup_fee, 0)
             - e.discount1_amount - e.discount2_amount;

  select coalesce(sum(amount), 0) into v_paid from payments where event_id = e.id;

  v_countdown := case when e.event_date is null then null
                 else (e.event_date - current_date) end;

  -- overtime $/hr from the pinned package version (falls back to the live package)
  v_overtime := coalesce(
    (select (pv.snapshot->>'overtime_hourly')::numeric
       from package_versions pv
      where pv.package_id = e.package_id and pv.version_no = e.package_version_no),
    p.overtime_hourly, 0);

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
  out_text := replace(out_text, '<retainer_amount>',
    to_char(coalesce(sp.amount, e.deposit_value, 0), 'FM$999,999,990.00'));
  out_text := replace(out_text, '<retainer_due_date>',
    coalesce(to_char(sp.due_date, 'FMMonth FMDD, YYYY'), 'upon signing'));
  out_text := replace(out_text, '<overtime_rate>', to_char(v_overtime, 'FM$999,999,990.00'));
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

-- ============ SEED: retainer request email (tags HTML-escaped for Tiptap) ============
insert into email_templates (group_name, name, subject, body_html)
select 'BOOKED', 'Retainer Payment Request',
  'One last step — your retainer for <event_date_long>',
  '<p>Hi &lt;first_name&gt;,</p>'
  || '<p>Thank you for signing your Booking Agreement — your &lt;event_type&gt; on &lt;event_date_long&gt; is almost locked in!</p>'
  || '<p>The final step is your retainer of <strong>&lt;retainer_amount&gt;</strong>, due &lt;retainer_due_date&gt;. Once it''s received, your date is officially reserved.</p>'
  || '&lt;payment_plan&gt;'
  || '<p>Reply to this email or give us a call and we''ll get your payment taken care of — whichever is easiest for you.</p>'
  || '<p>We can''t wait to celebrate with you!</p>'
where not exists (select 1 from email_templates where name = 'Retainer Payment Request');

-- ============ SEED: the after-sign helper ============
-- Runs automatically when the Booking Agreement is signed; also available as a
-- manual button. hide_if_already_ran keeps it one-shot per event.
insert into booking_helpers (title, button_text, button_bg, button_fg, position, hide_if_already_ran, actions)
select
  'After Sign — Booking Agreement',
  'Mark Booked + Send Confirmation & Retainer Request',
  '#4B328E', '#FFFFFF',
  (select coalesce(max(position), 0) + 1 from booking_helpers),
  true,
  jsonb_build_array(
    jsonb_build_object('type','set_status','status_id',
      (select id from event_statuses where name = 'Booked' limit 1)::text),
    jsonb_build_object('type','set_date','field','contract_signed_date','value','today'),
    jsonb_build_object('type','set_date','field','booked_date','value','today'),
    jsonb_build_object('type','send_email','template_id',
      (select id from email_templates where name = 'Booking Confirmation' and is_active limit 1)::text,'to','client'),
    jsonb_build_object('type','send_email','template_id',
      (select id from email_templates where name = 'Retainer Payment Request' and is_active limit 1)::text,'to','client'),
    jsonb_build_object('type','add_note','body',
      'Booking Agreement signed — status set to Booked; confirmation + retainer request emailed.')
  )
where not exists (select 1 from booking_helpers where title = 'After Sign — Booking Agreement');

-- ============ WIRE: Booking Agreement document template → helper ============
update document_templates
set after_sign_helper_id = (select id from booking_helpers where title = 'After Sign — Booking Agreement' limit 1)
where id = 'e2ae8026-0d1a-4681-be90-f130d572aec4' and after_sign_helper_id is null;
