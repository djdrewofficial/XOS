-- One source of truth for supported merge tags + strip unknowns in the renderer.
--
-- Problem: the email preview filled sample values for tags the real renderer never
-- implements (they exist only in the 132 imported DJEP templates: <event_date>,
-- <cell_phone>, <email>, <retainer_fee>, <event_location>, <salesperson_first_name>,
-- …). A staffer previewed an imported template, saw everything filled, enabled it —
-- and real sends went out with blank sentences ("Your salesperson is ."), because an
-- unhandled <tag> is an unknown element email clients silently drop.
--
-- Fix: supported_merge_tags() is the single list of every tag the SYSTEM resolves —
-- render_merge_tags' built-ins here, the CTA/set-password tags filled downstream by
-- enrichMessage (lib/mailgun.ts) / accounts.ts, and active custom tags. render_merge_tags
-- now strips any remaining unknown tag (so a real send never ships a raw <tag>), and
-- /api/email-preview flags those same unknowns in red instead of filling them.

create or replace function public.supported_merge_tags()
returns table (tag text)
language sql
stable
security definer
set search_path = public
as $$
  select t from unnest(array[
    -- render_merge_tags built-ins (keep in sync with the replace() calls below)
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
    -- resolved DOWNSTREAM (enrichMessage / accounts.ts), after render_merge_tags —
    -- must be preserved by the strip below
    'quote_summary','payment_plan','payment_link','payment_button','review_sign_link',
    'review_sign_button','journey_start_link','journey_start_button','document_sign_link',
    'set_password_button','set_password_link'
  ]) as t
  union
  select tag_key from merge_tags where is_active;
$$;

revoke all on function public.supported_merge_tags() from public;
grant execute on function public.supported_merge_tags() to authenticated, service_role;

-- Patch render_merge_tags in place off its live definition: add a loop variable and
-- a strip pass just before the final return. Aborts if either anchor moved, so we
-- never silently no-op.
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  decl_anchor text := 'v_dj_stage text; v_dj_first text; v_dj_last text; v_dj_phone text;';
  ret_anchor  text := E'  end loop;\n\n  return out_text;';
  strip_block text := $strip$  end loop;

  -- Strip merge tags no resolver implements, so a real send never ships a raw
  -- <salesperson_first_name> (email clients drop unknown elements, leaving blanks).
  -- Underscore tokens are unambiguously merge tags — HTML element names never contain
  -- "_" — and we also catch the few underscore-less DJEP leftovers (email/name/comments).
  -- Anything in supported_merge_tags() (built-ins + CTA/set-password tags filled
  -- downstream + active custom tags) and <document*> attachments are preserved.
  -- /api/email-preview flags these same unknowns in red: one shared contract.
  for v_unknown in
    select distinct mm[1]
    from regexp_matches(out_text, '<([a-zA-Z][a-zA-Z0-9_]*)>', 'g') as mm
    where (position('_' in mm[1]) > 0 or lower(mm[1]) in ('email','name','comments'))
      and lower(mm[1]) not in (select lower(tag) from supported_merge_tags())
      and lower(mm[1]) not like 'document%'
  loop
    out_text := replace(out_text, '<' || v_unknown || '>', '');
  end loop;

  return out_text;$strip$;
  new_src text;
begin
  if strpos(src, decl_anchor) = 0 then raise exception 'render_merge_tags declare anchor not found'; end if;
  if strpos(src, ret_anchor) = 0 then raise exception 'render_merge_tags return anchor not found'; end if;
  new_src := replace(src, decl_anchor, decl_anchor || ' v_unknown text;');
  new_src := replace(new_src, ret_anchor, strip_block);
  execute new_src;
end $mig$;
