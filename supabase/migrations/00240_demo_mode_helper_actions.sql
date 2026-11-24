-- Demo Mode helper actions + guest visibility + Send App Demo templates.
--
-- Schema / function changes (safe to apply):
--   * run_booking_helper recognizes demo_mode_on, demo_mode_off, send_app_demo
--     as deferred (TypeScript enableEventDemoMode / disableEventDemoMode /
--     sendAppDemo perform the real work after/before the RPC).
--   * event_guest_card exposes demo_mode for the couple app / portal.
--   * merge tag <app_store_link> (iPhone App Store only).
--   * Seed editable email + SMS templates named "Send App Demo" / "Send App Demo (SMS)".
--
-- DATA CHANGE (opt-in — NOT applied by this file):
--   To auto-turn Demo Mode off after signing, add a step to helper
--   "After Sign — Booking Agreement" (id d9d2c968-737f-4cfb-8c3c-2ce711ce894e):
--     {"type":"demo_mode_off","mode":"keep_client"}
--   Prefer keep_client so any songs/answers the prospect typed during the demo
--   are kept; use clean_slate only when you want a blank planner after signing.
--   Example (run manually after review):
--     update booking_helpers
--     set actions = actions || '[{"type":"demo_mode_off","mode":"keep_client"}]'::jsonb
--     where id = 'd9d2c968-737f-4cfb-8c3c-2ce711ce894e'
--       and not exists (
--         select 1 from jsonb_array_elements(actions) a
--         where a->>'type' = 'demo_mode_off'
--       );

-- 1) Guest card: couples/guests need demo_mode for banners.
-- Column order changed vs 00213 (demo_mode before event_type), so REPLACE is
-- not enough — Postgres rejects CREATE OR REPLACE when columns shift.
drop view if exists public.event_guest_card;
create view public.event_guest_card
  with (security_invoker = off, security_barrier = true) as
  select
    e.id,
    e.name,
    e.event_date,
    e.start_time,
    e.end_time,
    e.guest_count,
    e.cover_photo_url,
    e.event_type_id,
    e.demo_mode,
    et.name as event_type,
    v.name as venue_name
  from public.events e
  left join public.event_types et on et.id = e.event_type_id
  left join public.venues v on v.id = e.venue_id
  where public.xos_guest_of(e.id);

comment on view public.event_guest_card is
  'Event name, date, venue, and demo_mode for a guest. No prices, pay links, or private notes.';

revoke all on public.event_guest_card from public, anon;
grant select on public.event_guest_card to authenticated;

-- 2) Patch the 5-arg helper engine to accept the new action types as deferred.
do $$
declare
  src text;
  needle text := $n$when 'run_helper' then$n$;
  insert_text text := $i$when 'demo_mode_on' then
      -- Executed in app code (enableEventDemoMode) before/around this RPC.
      performed := performed || jsonb_build_object('demo_mode_on', 'deferred');

    when 'demo_mode_off' then
      -- Executed in app code (disableEventDemoMode). Default mode keep_client.
      performed := performed || jsonb_build_object(
        'demo_mode_off',
        coalesce(nullif(btrim(act->>'mode'), ''), 'keep_client')
      );

    when 'send_app_demo' then
      -- Executed in app code (sendAppDemo): enable demo + email/SMS join + App Store.
      performed := performed || jsonb_build_object('send_app_demo', 'deferred');

    when 'run_helper' then$i$;
begin
  src := pg_get_functiondef('public.run_booking_helper(uuid, uuid, jsonb, boolean, jsonb)'::regprocedure);
  -- Tagged $t$…$t$ (not bare dollar-quotes) so this does not close the outer DO block.
  if position($t$when 'demo_mode_on' then$t$ in src) > 0 then
    raise notice '00240: demo_mode helper actions already present';
    return;
  end if;
  if position(needle in src) = 0 then
    raise exception '00240: run_helper case not found in run_booking_helper — not patched';
  end if;
  src := replace(src, needle, insert_text);
  execute src;
end $$;

-- 3) Merge tag for the iPhone App Store link (filled at send time in TypeScript).
insert into public.merge_tags (tag_key, label, group_name, description, is_active, source_type, is_builtin, sort_order)
values (
  'app_store_link',
  'App Store link',
  'Account',
  'iPhone App Store link for Xpress Entertainment. Filled when the email or text is sent. Never Google Play / Android.',
  true,
  'builtin',
  true,
  5
)
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      is_builtin = true,
      source_type = 'builtin',
      is_active = true;

-- 4) Editable default templates for Send App Demo (idempotent by id / name).
insert into public.email_templates (
  id, name, display_name, group_name, subject, body_html,
  is_active, is_sms, sms_marketing, branded_shell
)
values (
  'd0e00001-5e1d-4a91-9e00-0000000a11e1',
  'Send App Demo',
  'Send App Demo',
  'APP',
  'Your Xpress planning app is ready',
  $html$<p>Hi <first_name>,</p>
<p>Drew from Xpress here. Your planning app is ready to explore.</p>
<p><a href="<app_host_link>">Tap here to join your event</a></p>
<p>No app yet? Grab it here: <a href="<app_store_link>"><app_store_link></a></p>
<p>Everything inside is sample info for now, so play around and save the real details for later. Once your booking agreement is signed, it switches over to your real plan.</p>
<p>Talk soon,<br/>Drew<br/>Xpress Entertainment</p>$html$,
  true, false, false, true
)
on conflict (id) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  group_name = excluded.group_name,
  subject = excluded.subject,
  body_html = excluded.body_html,
  is_active = excluded.is_active,
  is_sms = excluded.is_sms,
  sms_marketing = excluded.sms_marketing,
  branded_shell = excluded.branded_shell;

insert into public.email_templates (
  id, name, display_name, group_name, subject, body_html,
  is_active, is_sms, sms_marketing, branded_shell
)
values (
  'd0e00001-5e1d-4a91-9e00-00000005e501',
  'Send App Demo (SMS)',
  'Send App Demo (SMS)',
  'APP',
  '',
  $sms$Hi <first_name>! Drew from Xpress here. Your planning app is ready to explore. Tap to join your event: <app_host_link> No app yet? Grab it here: <app_store_link> Everything inside is sample info for now, so play around and save the real details for later. Once your booking agreement is signed, it switches over to your real plan.$sms$,
  true, true, false, false
)
on conflict (id) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  group_name = excluded.group_name,
  subject = excluded.subject,
  body_html = excluded.body_html,
  is_active = excluded.is_active,
  is_sms = excluded.is_sms,
  sms_marketing = excluded.sms_marketing,
  branded_shell = excluded.branded_shell;
