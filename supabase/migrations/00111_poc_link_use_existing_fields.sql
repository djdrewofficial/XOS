-- 00111_poc_link_use_existing_fields.sql
-- Correction to 00110: employees already have planning_meeting_url + website, so
-- POC link tags should resolve to those existing profile fields instead of the
-- redundant columns 00110 added. Drop the unused columns, keep one POC link tag
-- (<poc_planning_link> -> planning_meeting_url), and fix the poc_field whitelist.

alter table employees drop column if exists planning_link;
alter table employees drop column if exists meeting_link;
delete from merge_tags where tag_key = 'poc_meeting_link';

create or replace function render_merge_tags(p_event_id uuid, p_template text)
returns text language plpgsql security definer set search_path = public as $$
declare
  e record; c record; v record; p record; cs record; sp record; poc record; m record;
  v_val text; out_text text := coalesce(p_template, '');
  v_total numeric := 0; v_paid numeric := 0; v_addons numeric := 0; v_countdown int;
  v_overtime numeric := 0; v_venue_addr text; v_billing_terms text;
begin
  out_text := replace(out_text, '&lt;', '<');
  out_text := replace(out_text, '&gt;', '>');
  select * into e from events where id = p_event_id;
  if not found then return out_text; end if;
  select * into c from clients where id = e.client_id;
  select * into v from venues where id = e.venue_id;
  select * into p from packages where id = e.package_id;
  select * into cs from company_settings where id = true;
  select * into sp from scheduled_payments where event_id = e.id order by seq limit 1;
  select * into poc from employees where id = e.point_of_contact_employee_id;
  select coalesce(sum(quantity * coalesce(ea.price_override, ea.price_locked, a.default_price)), 0) into v_addons
  from event_addons ea join addons a on a.id = ea.addon_id where ea.event_id = e.id;
  v_total := coalesce(e.package_price_override, e.package_price_locked, p.default_price, 0)
             + v_addons + e.overtime_fee + e.travel_fee + coalesce(v.setup_fee, 0)
             - e.discount1_amount - e.discount2_amount;
  select coalesce(sum(amount), 0) into v_paid from payments where event_id = e.id;
  v_countdown := case when e.event_date is null then null else (e.event_date - current_date) end;
  v_overtime := coalesce((select (pv.snapshot->>'overtime_hourly')::numeric from package_versions pv
      where pv.package_id = e.package_id and pv.version_no = e.package_version_no), p.overtime_hourly, 0);
  v_venue_addr := concat_ws(', ', nullif(v.address, ''), nullif(v.city, ''),
    nullif(trim(concat_ws(' ', nullif(v.state, ''), nullif(v.zip, ''))), ''));
  v_billing_terms := case e.billing_terms when 'up_front' then 'Due Up Front' when 'net_30' then 'Net 30'
    when 'installments' then 'Installments' else coalesce(e.billing_terms, 'None') end;

  out_text := replace(out_text, '<first_name>', coalesce(c.first_name, ''));
  out_text := replace(out_text, '<last_name>', coalesce(c.last_name, ''));
  out_text := replace(out_text, '<client_name>', trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')));
  out_text := replace(out_text, '<client_email>', coalesce(c.email, ''));
  out_text := replace(out_text, '<client_cell>', coalesce(c.cell_phone, ''));
  out_text := replace(out_text, '<client_organization>', coalesce(c.organization, ''));
  out_text := replace(out_text, '<client_address>', coalesce(c.mailing_address, ''));
  out_text := replace(out_text, '<authorized_rep_name>', coalesce(c.authorized_rep_name, ''));
  out_text := replace(out_text, '<authorized_rep_title>', coalesce(c.authorized_rep_title, ''));
  out_text := replace(out_text, '<authorized_rep_email>', coalesce(c.authorized_rep_email, ''));
  out_text := replace(out_text, '<authorized_rep_phone>', coalesce(c.authorized_rep_phone, ''));
  out_text := replace(out_text, '<event_name>', coalesce(e.name, ''));
  out_text := replace(out_text, '<event_type>', coalesce((select name from event_types where id = e.event_type_id), ''));
  out_text := replace(out_text, '<event_date_long>', coalesce(to_char(e.event_date, 'FMDay, FMMonth FMDD, YYYY'), ''));
  out_text := replace(out_text, '<event_date_short>', coalesce(to_char(e.event_date, 'MM/DD/YYYY'), ''));
  out_text := replace(out_text, '<event_date_countdown>', coalesce(v_countdown::text, ''));
  out_text := replace(out_text, '<venue_name>', coalesce(v.name, ''));
  out_text := replace(out_text, '<venue_address>', coalesce(v_venue_addr, ''));
  out_text := replace(out_text, '<package_name>', coalesce(p.name, ''));
  out_text := replace(out_text, '<setup_time>', coalesce(to_char(e.setup_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<guest_count>', coalesce(e.guest_count::text, ''));
  out_text := replace(out_text, '<decision_maker_name>', coalesce(e.decision_maker_name, ''));
  out_text := replace(out_text, '<decision_maker_phone>', coalesce(e.decision_maker_phone, ''));
  out_text := replace(out_text, '<decision_maker_email>', coalesce(e.decision_maker_email, ''));
  out_text := replace(out_text, '<billing_terms>', v_billing_terms);
  out_text := replace(out_text, '<total_fee>', to_char(v_total, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<payments_received>', to_char(v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<balance_due>', to_char(v_total - v_paid, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<deposit_value>', to_char(e.deposit_value, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<retainer_amount>', to_char(coalesce(sp.amount, e.deposit_value, 0), 'FM$999,999,990.00'));
  out_text := replace(out_text, '<retainer_due_date>', coalesce(to_char(sp.due_date, 'FMMonth FMDD, YYYY'), 'upon signing'));
  out_text := replace(out_text, '<overtime_rate>', to_char(v_overtime, 'FM$999,999,990.00'));
  out_text := replace(out_text, '<start_time>', coalesce(to_char(e.start_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<end_time>', coalesce(to_char(e.end_time, 'FMHH12:MI AM'), ''));
  out_text := replace(out_text, '<company_name>', coalesce(cs.company_name, 'Xpress Entertainment'));
  out_text := replace(out_text, '<company_email_signature>', coalesce(cs.email_signature_html, ''));
  out_text := replace(out_text, '<email_signature>', coalesce(cs.email_signature_html, ''));
  out_text := replace(out_text, '<legal_venue>', coalesce(nullif(cs.legal_venue, ''), 'Broward County, Florida'));
  out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));

  out_text := replace(out_text, '<poc_name>', trim(coalesce(poc.first_name,'') || ' ' || coalesce(poc.last_name,'')));
  out_text := replace(out_text, '<poc_first_name>', coalesce(poc.first_name, ''));
  out_text := replace(out_text, '<poc_last_name>', coalesce(poc.last_name, ''));
  out_text := replace(out_text, '<poc_email>', coalesce(poc.email, ''));
  out_text := replace(out_text, '<poc_phone>', coalesce(poc.phone, ''));
  out_text := replace(out_text, '<poc_planning_link>', coalesce(poc.planning_meeting_url, ''));

  for m in select * from merge_tags where is_active and not is_builtin loop
    v_val := null;
    if m.source_type = 'static' then
      v_val := m.source_value;
    elsif m.source_type = 'poc_field' and m.source_value in ('first_name','last_name','email','phone','planning_meeting_url','website') then
      execute format('select %I::text from employees where id = $1', m.source_value) into v_val using e.point_of_contact_employee_id;
    elsif m.source_type = 'client_field' and m.source_value in ('first_name','last_name','email','cell_phone','organization','mailing_address') then
      execute format('select %I::text from clients where id = $1', m.source_value) into v_val using e.client_id;
    elsif m.source_type = 'event_field' and m.source_value in ('name','guest_count','event_date','start_time','end_time','setup_time') then
      execute format('select %I::text from events where id = $1', m.source_value) into v_val using e.id;
    elsif m.source_type = 'company_field' and m.source_value in ('company_name','from_email','reply_to','legal_venue','instagram_url','tiktok_url') then
      execute format('select %I::text from company_settings where id = true') into v_val;
    end if;
    out_text := replace(out_text, '<' || m.tag_key || '>', coalesce(v_val, ''));
  end loop;

  return out_text;
end; $$;
grant execute on function render_merge_tags(uuid, text) to authenticated;
