-- 00110_point_of_contact_and_merge_tags.sql
-- 1. Point of Contact: an employee assigned to an event; emails can send "from"
--    them and POC merge tags (<poc_name>, <poc_planning_link>, …) resolve to them.
-- 2. Employee link fields used by POC tags (planning/meeting links).
-- 3. merge_tags registry: a managed catalog of every merge tag (builtin + custom),
--    powering the settings page, the editor dropdown, and the AI wizard. Custom
--    tags are resolved dynamically by render_merge_tags.

alter table events add column if not exists point_of_contact_employee_id uuid references employees(id);
alter table employees add column if not exists planning_link text;
alter table employees add column if not exists meeting_link text;

create table if not exists merge_tags (
  id uuid primary key default gen_random_uuid(),
  tag_key text not null unique,           -- stored WITHOUT angle brackets, e.g. poc_planning_link
  label text not null,
  group_name text not null default 'CUSTOM',
  description text,
  is_builtin boolean not null default false,  -- builtin = resolved by hardcoded SQL; catalog-only here
  source_type text not null default 'static', -- builtin | static | poc_field | event_field | client_field | company_field
  source_value text,                          -- static text, or a whitelisted column name
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table merge_tags enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='merge_tags' and policyname='authenticated full access') then
    create policy "authenticated full access" on merge_tags for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Seed the builtin catalog (catalog only — these stay resolved by render_merge_tags).
insert into merge_tags (tag_key, label, group_name, description, is_builtin, source_type)
select x.tag_key, x.label, x.group_name, x.description, true, 'builtin'
from jsonb_to_recordset($seed$[
 {"tag_key":"first_name","label":"First Name","group_name":"Client","description":"Primary client first name"},
 {"tag_key":"last_name","label":"Last Name","group_name":"Client","description":"Primary client last name"},
 {"tag_key":"client_name","label":"Full Name","group_name":"Client","description":"Primary client full name"},
 {"tag_key":"client_organization","label":"Organization","group_name":"Client","description":"Client company/organization"},
 {"tag_key":"client_email","label":"Client Email","group_name":"Client","description":"Primary client email"},
 {"tag_key":"client_cell","label":"Client Cell","group_name":"Client","description":"Primary client cell phone"},
 {"tag_key":"client_address","label":"Client Address","group_name":"Client","description":"Client mailing address"},
 {"tag_key":"authorized_rep_name","label":"Authorized Rep Name","group_name":"Client","description":"Corporate signer name"},
 {"tag_key":"authorized_rep_title","label":"Authorized Rep Title","group_name":"Client","description":"Corporate signer title"},
 {"tag_key":"authorized_rep_email","label":"Authorized Rep Email","group_name":"Client","description":"Corporate signer email"},
 {"tag_key":"authorized_rep_phone","label":"Authorized Rep Phone","group_name":"Client","description":"Corporate signer phone"},
 {"tag_key":"event_name","label":"Event Name","group_name":"Event","description":"Event name"},
 {"tag_key":"event_type","label":"Event Type","group_name":"Event","description":"Event type"},
 {"tag_key":"event_date_long","label":"Event Date (Long)","group_name":"Event","description":"e.g. Saturday, August 15, 2026"},
 {"tag_key":"event_date_short","label":"Event Date (Short)","group_name":"Event","description":"e.g. 08/15/2026"},
 {"tag_key":"event_date_countdown","label":"Days Until Event","group_name":"Event","description":"Days from today to the event"},
 {"tag_key":"venue_name","label":"Venue Name","group_name":"Event","description":"Venue name"},
 {"tag_key":"venue_address","label":"Venue Address","group_name":"Event","description":"Venue street/city/state"},
 {"tag_key":"package_name","label":"Package Name","group_name":"Event","description":"Booked package"},
 {"tag_key":"setup_time","label":"Setup Time","group_name":"Event","description":"Setup time"},
 {"tag_key":"start_time","label":"Start Time","group_name":"Event","description":"Event start time"},
 {"tag_key":"end_time","label":"End Time","group_name":"Event","description":"Event end time"},
 {"tag_key":"guest_count","label":"Guest Count","group_name":"Event","description":"Estimated guests"},
 {"tag_key":"billing_terms","label":"Billing Terms","group_name":"Event","description":"Readable billing terms"},
 {"tag_key":"decision_maker_name","label":"Decision Maker Name","group_name":"Event","description":"On-site approver"},
 {"tag_key":"decision_maker_phone","label":"Decision Maker Phone","group_name":"Event","description":"On-site approver phone"},
 {"tag_key":"decision_maker_email","label":"Decision Maker Email","group_name":"Event","description":"On-site approver email"},
 {"tag_key":"total_fee","label":"Total Fee","group_name":"Money","description":"Total investment"},
 {"tag_key":"balance_due","label":"Balance Due","group_name":"Money","description":"Remaining balance"},
 {"tag_key":"payments_received","label":"Payments Received","group_name":"Money","description":"Total paid"},
 {"tag_key":"deposit_value","label":"Deposit","group_name":"Money","description":"Deposit value"},
 {"tag_key":"retainer_amount","label":"Retainer Amount","group_name":"Money","description":"Retainer amount"},
 {"tag_key":"retainer_due_date","label":"Retainer Due Date","group_name":"Money","description":"Retainer due date"},
 {"tag_key":"overtime_rate","label":"Overtime Rate","group_name":"Money","description":"Overtime $/hr"},
 {"tag_key":"company_name","label":"Company Name","group_name":"Company","description":"Your company name"},
 {"tag_key":"company_email_signature","label":"Email Signature","group_name":"Company","description":"Company email signature HTML"},
 {"tag_key":"legal_venue","label":"Legal Venue","group_name":"Company","description":"Governing-law jurisdiction"},
 {"tag_key":"current_date","label":"Current Date","group_name":"Company","description":"Today's date"},
 {"tag_key":"poc_name","label":"POC Full Name","group_name":"Point of Contact","description":"Assigned point of contact full name"},
 {"tag_key":"poc_first_name","label":"POC First Name","group_name":"Point of Contact","description":"POC first name"},
 {"tag_key":"poc_last_name","label":"POC Last Name","group_name":"Point of Contact","description":"POC last name"},
 {"tag_key":"poc_email","label":"POC Email","group_name":"Point of Contact","description":"POC email"},
 {"tag_key":"poc_phone","label":"POC Phone","group_name":"Point of Contact","description":"POC phone"},
 {"tag_key":"poc_planning_link","label":"POC Planning Link","group_name":"Point of Contact","description":"POC's planning meeting link"},
 {"tag_key":"poc_meeting_link","label":"POC Meeting Link","group_name":"Point of Contact","description":"POC's general meeting/booking link"},
 {"tag_key":"quote_summary","label":"Quote Summary","group_name":"Documents","description":"Package + add-ons + total block"},
 {"tag_key":"payment_plan","label":"Payment Plan","group_name":"Documents","description":"Scheduled payments block"},
 {"tag_key":"document_sign_link","label":"Document Sign Link","group_name":"Documents","description":"E-sign link for the attached document"},
 {"tag_key":"review_sign_link","label":"Review & Sign Link","group_name":"Documents","description":"Review-and-sign URL"},
 {"tag_key":"review_sign_button","label":"Review & Sign Button","group_name":"Documents","description":"Review-and-sign button"},
 {"tag_key":"payment_button","label":"Payment Button","group_name":"Payments","description":"Pay-now button"},
 {"tag_key":"payment_link","label":"Payment Link","group_name":"Payments","description":"Pay-now URL"}
]$seed$::jsonb) as x(tag_key text, label text, group_name text, description text)
on conflict (tag_key) do nothing;

-- ============ SENDER RESOLVER (re-created: + point_of_contact) ============
create or replace function resolve_sender(p_event_id uuid, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cs record;
  emp record;
  e record;
  v_name text;
  v_email text;
begin
  select * into cs from company_settings where id = true;

  if p_from in ('salesperson', 'primary_dj', 'assigned_dj', 'point_of_contact', 'poc') then
    select * into e from events where id = p_event_id;

    if p_from = 'salesperson' then
      select em.* into emp from employees em
      where em.id = e.salesperson_id and em.is_active and em.can_send_as_self
        and em.email is not null and em.email <> '';
    elsif p_from in ('point_of_contact', 'poc') then
      select em.* into emp from employees em
      where em.id = e.point_of_contact_employee_id and em.is_active and em.can_send_as_self
        and em.email is not null and em.email <> '';
    else
      select em.* into emp from event_staff es
      join employees em on em.id = es.employee_id
      where es.event_id = p_event_id and em.is_active and em.can_send_as_self
        and em.email is not null and em.email <> ''
      order by (es.role ilike '%dj%') desc, es.created_at
      limit 1;
    end if;

    if found then
      v_name := trim(coalesce(emp.first_name, '') || ' ' || coalesce(emp.last_name, ''));
      v_email := emp.email;
    end if;
  end if;

  if v_email is null then
    v_name := coalesce(cs.from_name, 'Xpress Entertainment');
    v_email := coalesce(cs.from_email, 'events@xpressdjs.com');
    return jsonb_build_object('name', v_name, 'email', v_email, 'reply_to', cs.reply_to);
  end if;

  return jsonb_build_object('name', v_name, 'email', v_email, 'reply_to', v_email);
end;
$$;
grant execute on function resolve_sender(uuid, text) to authenticated;

-- ============ MERGE TAGS v7 (+ Point of Contact tags + custom registry) ============
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
  poc record;
  m record;
  v_val text;
  out_text text := coalesce(p_template, '');
  v_total numeric := 0;
  v_paid numeric := 0;
  v_addons numeric := 0;
  v_countdown int;
  v_overtime numeric := 0;
  v_venue_addr text;
  v_billing_terms text;
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

  select coalesce(sum(quantity * coalesce(ea.price_override, ea.price_locked, a.default_price)), 0)
    into v_addons
  from event_addons ea join addons a on a.id = ea.addon_id
  where ea.event_id = e.id;

  v_total := coalesce(e.package_price_override, e.package_price_locked, p.default_price, 0)
             + v_addons + e.overtime_fee + e.travel_fee
             + coalesce(v.setup_fee, 0)
             - e.discount1_amount - e.discount2_amount;

  select coalesce(sum(amount), 0) into v_paid from payments where event_id = e.id;

  v_countdown := case when e.event_date is null then null else (e.event_date - current_date) end;

  v_overtime := coalesce(
    (select (pv.snapshot->>'overtime_hourly')::numeric
       from package_versions pv
      where pv.package_id = e.package_id and pv.version_no = e.package_version_no),
    p.overtime_hourly, 0);

  v_venue_addr := concat_ws(', ',
    nullif(v.address, ''), nullif(v.city, ''),
    nullif(trim(concat_ws(' ', nullif(v.state, ''), nullif(v.zip, ''))), ''));

  v_billing_terms := case e.billing_terms
    when 'up_front' then 'Due Up Front' when 'net_30' then 'Net 30'
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

  -- Point of Contact (assigned employee on the event)
  out_text := replace(out_text, '<poc_name>', trim(coalesce(poc.first_name,'') || ' ' || coalesce(poc.last_name,'')));
  out_text := replace(out_text, '<poc_first_name>', coalesce(poc.first_name, ''));
  out_text := replace(out_text, '<poc_last_name>', coalesce(poc.last_name, ''));
  out_text := replace(out_text, '<poc_email>', coalesce(poc.email, ''));
  out_text := replace(out_text, '<poc_phone>', coalesce(poc.phone, ''));
  out_text := replace(out_text, '<poc_planning_link>', coalesce(poc.planning_link, ''));
  out_text := replace(out_text, '<poc_meeting_link>', coalesce(poc.meeting_link, ''));

  -- Custom registry tags (whitelisted columns only)
  for m in select * from merge_tags where is_active and not is_builtin loop
    v_val := null;
    if m.source_type = 'static' then
      v_val := m.source_value;
    elsif m.source_type = 'poc_field' and m.source_value in ('first_name','last_name','email','phone','planning_link','meeting_link') then
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
end;
$$;
grant execute on function render_merge_tags(uuid, text) to authenticated;
