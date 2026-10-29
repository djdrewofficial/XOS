-- Merge tags used as a link's href were stored by the rich-text editor as
-- href="&lt;tag&gt;" (and sometimes href="%3Ctag%3E"). render_merge_tags already
-- decoded &lt; / &gt; and replaced known tags, then the unknown-tag stripper
-- deleted anything it did not implement. <custom_field9> is not a registered
-- tag, so the photo-booth template's "CLICK HERE" link rendered as href="".
--
-- The gallery URL lives on the event as custom_fields.photobooth_gallery
-- (event page → Vibo & Files → Photo Booth Gallery). There was no merge tag
-- for it. <custom_field9> is only used by "Your Photo Booth Pictures Are Ready!"
-- and the copy around it is the gallery download link, so that legacy DJEP
-- number resolves to the same value. New templates should use
-- <photobooth_gallery> (it shows in the merge-tag picker). <custom_field9> is
-- not added to the picker.
--
-- After substitution, every href is reduced to a safe absolute URL
-- (http, https, mailto, tel). Empty values, names, relative paths, and
-- javascript:/data:/vbscript: values lose the attribute. A still-unresolved
-- <tag_with_underscore> (payment_link, set_password_link, …) is left for the
-- send-time pass that fills it.
--
-- Keep the rules in sync with src/lib/mergeHref.ts.

create or replace function public.xos_safe_href(raw text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v text := coalesce(raw, '');
  scheme text;
begin
  v := regexp_replace(v, '[[:cntrl:]]', '', 'g');
  v := regexp_replace(v, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if v = '' then return ''; end if;
  if v ~ '[[:space:]]' or v ~ '[<>"'']' or position(E'\\' in v) > 0 or position('&#' in v) > 0 then
    return '';
  end if;
  if left(v, 2) = '//' then return ''; end if;
  if position(':' in v) > 0 then
    scheme := lower(split_part(v, ':', 1));
    if scheme not in ('http', 'https', 'mailto', 'tel') then return ''; end if;
  elsif v ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([:/?#].*)?$' then
    v := 'https://' || v;
  else
    return '';
  end if;
  return replace(replace(replace(v, '&', '&amp;'), '"', '&quot;'), '''', '&#39;');
end;
$fn$;

create or replace function public.xos_sanitize_href_attrs(html text)
returns text
language plpgsql
immutable
set search_path = public
as $fn$
declare
  src text := coalesce(html, '');
  out text := '';
  pos int := 1;
  hit int;
  q int;
  raw text;
  unesc text;
  safe text;
begin
  while pos <= length(src) + 1 loop
    hit := strpos(lower(substring(src from pos)), 'href="');
    if hit = 0 then
      out := out || substring(src from pos);
      exit;
    end if;
    hit := pos + hit - 1;
    out := out || substring(src from pos for hit - pos);
    q := strpos(substring(src from hit + 6), '"');
    if q = 0 then
      out := out || substring(src from hit);
      exit;
    end if;
    raw := substring(src from hit + 6 for q - 1);
    if raw ~ '^<[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*>$'
       or raw ~* '^&lt;[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*&gt;$'
       or raw ~* '^%3C[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*%3E$' then
      out := out || substring(src from hit for 6 + q);
    else
      unesc := replace(replace(replace(replace(replace(raw,
        '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&');
      safe := xos_safe_href(unesc);
      if safe <> '' then
        out := out || 'href="' || safe || '"';
      end if;
    end if;
    pos := hit + 6 + (q - 1) + 1;
  end loop;
  return out;
end;
$fn$;

revoke all on function public.xos_safe_href(text) from public;
revoke all on function public.xos_sanitize_href_attrs(text) from public;
grant execute on function public.xos_safe_href(text) to authenticated, service_role;
grant execute on function public.xos_sanitize_href_attrs(text) to authenticated, service_role;

insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values (
  'photobooth_gallery',
  'Photo Booth Gallery',
  'Event',
  'The event''s photo booth gallery link (event page → Vibo & Files).',
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

-- Legacy <custom_field9> is recognized so the existing photo-booth template
-- previews as supported, but it is not a picker entry. <photobooth_gallery>
-- is also listed here; the merge_tags row above is what the picker reads.
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
    'set_password_button','set_password_link','photobooth_gallery','custom_field9'
  ]) as t
  union
  select tag_key from merge_tags where is_active;
$$;

revoke all on function public.supported_merge_tags() from public;
grant execute on function public.supported_merge_tags() to anon, authenticated, service_role;

do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  decode_anchor text := $a$  out_text := replace(out_text, '&gt;', '>');$a$;
  decode_add text := $a$  out_text := replace(out_text, '&gt;', '>');
  -- Percent-encoded merge tags (%3Ctag%3E). An underscore is required so
  -- %3Cscript%3E is not turned into a real element. Mirrors decodeMergeTagDelimiters.
  out_text := regexp_replace(out_text, '%3[Cc]([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*)%3[Ee]', '<\1>', 'g');$a$;
  gallery_anchor text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));$a$;
  gallery_add text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));
  -- Photo booth gallery. <custom_field9> is the legacy DJEP number still stored
  -- in "Your Photo Booth Pictures Are Ready!"; <photobooth_gallery> is the tag
  -- to use from here on. Both read events.custom_fields.photobooth_gallery.
  out_text := replace(out_text, '<photobooth_gallery>', xos_html_escape(coalesce(e.custom_fields->>'photobooth_gallery', '')));
  out_text := replace(out_text, '<custom_field9>', xos_html_escape(coalesce(e.custom_fields->>'photobooth_gallery', '')));$a$;
  ret_anchor text := $a$  end loop;

  return out_text;$a$;
  ret_add text := $a$  end loop;

  out_text := public.xos_sanitize_href_attrs(out_text);

  return out_text;$a$;
begin
  if position('<photobooth_gallery>' in src) > 0 and position('xos_sanitize_href_attrs' in src) > 0 then
    return;
  end if;
  if strpos(src, decode_anchor) = 0 then
    raise exception 'render_merge_tags: &gt; decode anchor not found';
  end if;
  if strpos(src, gallery_anchor) = 0 then
    raise exception 'render_merge_tags: <current_date> anchor not found';
  end if;
  if strpos(src, ret_anchor) = 0 then
    raise exception 'render_merge_tags: final return anchor not found';
  end if;
  if position('%3[Cc]' in src) = 0 then
    src := replace(src, decode_anchor, decode_add);
  end if;
  if position('<photobooth_gallery>' in src) = 0 then
    src := replace(src, gallery_anchor, gallery_add);
  end if;
  if position('xos_sanitize_href_attrs' in src) = 0 then
    src := replace(src, ret_anchor, ret_add);
  end if;
  execute src;
end
$mig$;
