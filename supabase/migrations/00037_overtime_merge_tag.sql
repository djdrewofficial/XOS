-- XOS — render_merge_tags v4:
--   + <overtime_rate> (the event's package overtime $/hr, from the PINNED package
--     version when the event has one — consistent with price locking)
--   + totals now respect locked prices (package_price_locked / event_addons.price_locked)
--   + <total_fee> includes the venue setup fee, matching the document fee table

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
