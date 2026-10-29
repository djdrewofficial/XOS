-- Vibo link merge tag.
--
-- Existing email templates store the event's Vibo link as <custom_field7>:
-- as href="&lt;custom_field7&gt;" on the booked Vibo emails, as visible text
-- "&lt;custom_field7&gt;" on the "We're Alive" emails, and as a raw
-- <custom_field7> on the Zapier "Update High Level" templates. That tag was
-- never implemented, so the unknown-tag stripper deleted it.
--
-- The URL is events.custom_fields.vibo_link (event page → Vibo & Files →
-- Vibo Event Link). <vibo_link> is the tag to use from here on and shows in
-- the merge-tag picker. <custom_field7> resolves to the same value and is
-- not added to the picker.
--
-- After substitution, href safety is unchanged from 00202: an href is kept
-- only for a safe absolute URL (http, https, mailto, tel). Empty values,
-- plain text, relative paths, and javascript:/data:/vbscript: lose the
-- attribute. A URL used as body text is HTML-escaped and left as text.
--
-- Requires 00202 (the <custom_field9> line this patch anchors on, and
-- xos_sanitize_href_attrs).

insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values (
  'vibo_link',
  'Vibo Event Link',
  'Event',
  'The event''s Vibo planning link (event page → Vibo & Files → Vibo Event Link).',
  'builtin',
  null,
  true,
  true
)
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      source_type = 'builtin',
      is_builtin = true,
      is_active = true;

-- Legacy <custom_field7> is recognized so the existing Vibo templates preview
-- as supported, but it is not a picker entry. <vibo_link> is also listed here;
-- the merge_tags row above is what the picker reads.
create or replace function public.supported_merge_tags()
returns table (tag text)
language sql
stable
security definer
set search_path = public
as $$
  select t from unnest(array[
    'first_name','last_name','client_name','client_email','client_cell',
    'client_organization','client_address','authorized_rep_name','authorized_rep_title',
    'authorized_rep_email','authorized_rep_phone','event_name','event_type',
    'event_date_long','event_date_short','event_date_countdown','venue_name',
    'venue_address','event_location_manager','event_location_cell_phone',
    'event_location_comments','booking_comments','package_name','package_description',
    'package_price','addon_total_price','setup_time','guest_count',
    'decision_maker_name','decision_maker_phone','decision_maker_email','billing_terms',
    'total_fee','payments_received','balance_due','deposit_value','retainer_amount',
    'retainer_due_date','second_payment_amount','second_payment_date',
    'third_payment_amount','third_payment_date_medium','overtime_rate','start_time',
    'end_time','company_name','company_email_signature','email_signature','legal_venue',
    'current_date','poc_name','poc_first_name','poc_last_name','poc_email','poc_phone',
    'poc_planning_link','djemployee1_stage_name','djemployee1_cell_phone',
    'employee_table4','addon_list_no_prices','addon_list_line_breaks','discount',
    'quote_summary','payment_plan','payment_link','payment_button','review_sign_link',
    'review_sign_button','journey_start_link','journey_start_button','document_sign_link',
    'set_password_button','set_password_link','photobooth_gallery','custom_field9',
    'vibo_link','custom_field7'
  ]) as t
  union
  select tag_key from merge_tags where is_active;
$$;

revoke all on function public.supported_merge_tags() from public;
grant execute on function public.supported_merge_tags() to anon, authenticated, service_role;

do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$  out_text := replace(out_text, '<custom_field9>', xos_html_escape(coalesce(e.custom_fields->>'photobooth_gallery', '')));$a$;
  addition text := $a$  out_text := replace(out_text, '<custom_field9>', xos_html_escape(coalesce(e.custom_fields->>'photobooth_gallery', '')));
  -- Vibo planning link. <custom_field7> is the legacy DJEP number still stored
  -- in the booked Vibo emails and the Zapier "Update High Level" templates;
  -- <vibo_link> is the tag to use from here on. Both read events.custom_fields.vibo_link.
  out_text := replace(out_text, '<vibo_link>', xos_html_escape(coalesce(e.custom_fields->>'vibo_link', '')));
  out_text := replace(out_text, '<custom_field7>', xos_html_escape(coalesce(e.custom_fields->>'vibo_link', '')));$a$;
begin
  if position($v$e.custom_fields->>'vibo_link'$v$ in src) > 0 then
    return;
  end if;
  if strpos(src, anchor) = 0 then
    raise exception 'render_merge_tags: <custom_field9> anchor not found (apply 00202 first)';
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: <custom_field9> anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;
