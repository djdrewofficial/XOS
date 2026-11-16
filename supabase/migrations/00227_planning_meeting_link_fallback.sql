-- Fix blank planning-meeting CTAs in "We're Alive 6 (30 Days) (May 2025)".
--
-- Root cause (not a missing DJ profile field, not a HighLevel custom field):
--   Template tag: <poc_planning_link>
--   Source field:  employees.planning_meeting_url on the event's Point of Contact
--                  (events.point_of_contact_employee_id)
--   On DJ Atomic events that POC is usually null, so the tag renders blank even
--   though the assigned DJ's employees.planning_meeting_url is filled
--   (e.g. https://www.xpressdjs.com/atomicplanning). <dj_calendar_link> already
--   reads the DJ column and fills correctly on those same events.
--
-- Render-time chain (never blank):
--   1) POC planning_meeting_url when the POC is set and the URL is non-empty
--   2) Assigned DJ planning_meeting_url (same primary-DJ pick as <djemployee1_*>)
--   3) xos_default_planning_meeting_url() (company booking link; single source)
--
-- <dj_calendar_link> uses steps 2 then 3 (DJ first; that is its existing field).
-- Fallback URL lives in xos_default_planning_meeting_url() only.
--
-- CREATE OR REPLACE helpers, then CREATE OR REPLACE render_merge_tags from the
-- live definition (keeps 00226 receipt tags + financials-hidden / field-staff
-- money blanking). Apply after merge; do not apply from the PR agent.

create or replace function public.xos_default_planning_meeting_url()
returns text
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select 'https://xpressdjs.com/drewplanning/'::text;
$fn$;

comment on function public.xos_default_planning_meeting_url() is
  'Company fallback URL for planning-meeting merge tags when POC and DJ links are empty.';

-- Assigned DJ planning_meeting_url, or the company fallback. Used by <dj_calendar_link>.
create or replace function public.xos_dj_planning_meeting_url(p_event_id uuid)
returns text
language sql
stable
parallel safe
set search_path = public
as $fn$
  select coalesce(
    nullif(btrim((
      select em.planning_meeting_url
      from event_staff es
      join employees em on em.id = es.employee_id
      where es.event_id = p_event_id
      order by (es.role ilike '%dj%') desc, em.stage_name nulls last, em.first_name
      limit 1
    )), ''),
    public.xos_default_planning_meeting_url()
  );
$fn$;

comment on function public.xos_dj_planning_meeting_url(uuid) is
  'Assigned DJ planning_meeting_url for an event, or the company fallback when missing.';

-- POC planning_meeting_url → DJ planning_meeting_url → company fallback.
-- Used by <poc_planning_link> (30-day planning email).
create or replace function public.xos_event_planning_meeting_url(p_event_id uuid)
returns text
language sql
stable
parallel safe
set search_path = public
as $fn$
  select coalesce(
    nullif(btrim((
      select em.planning_meeting_url
      from events e
      join employees em on em.id = e.point_of_contact_employee_id
      where e.id = p_event_id
    )), ''),
    public.xos_dj_planning_meeting_url(p_event_id)
  );
$fn$;

comment on function public.xos_event_planning_meeting_url(uuid) is
  'POC planning_meeting_url, else assigned DJ planning_meeting_url, else company fallback.';

revoke all on function public.xos_default_planning_meeting_url() from public, anon;
grant execute on function public.xos_default_planning_meeting_url() to authenticated, service_role;
revoke all on function public.xos_dj_planning_meeting_url(uuid) from public, anon;
grant execute on function public.xos_dj_planning_meeting_url(uuid) to authenticated, service_role;
revoke all on function public.xos_event_planning_meeting_url(uuid) from public, anon;
grant execute on function public.xos_event_planning_meeting_url(uuid) to authenticated, service_role;

update public.merge_tags
set description = 'Point of Contact planning meeting link; falls back to the assigned DJ planning_meeting_url, then the company booking link.'
where tag_key = 'poc_planning_link';

update public.merge_tags
set description = 'The assigned DJ''s planning meeting / calendar link (falls back to the company booking link when empty).'
where tag_key = 'dj_calendar_link';

-- CREATE OR REPLACE render_merge_tags from the live def so every prior patch
-- (00226 receipt tags, financials-hidden blanking, field-staff access, …) stays.
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  old_dj text := $a$if position('<dj_calendar_link>' in out_text) > 0 then
    out_text := replace(out_text, '<dj_calendar_link>', xos_html_escape(coalesce((
      select em.planning_meeting_url
      from event_staff es join employees em on em.id = es.employee_id
      where es.event_id = e.id
      order by (es.role ilike '%dj%') desc, em.stage_name nulls last, em.first_name
      limit 1
    ), '')));
  end if;$a$;
  new_dj text := $a$out_text := replace(out_text, '<dj_calendar_link>',
    xos_html_escape(public.xos_dj_planning_meeting_url(e.id)));$a$;
  -- Also replace a prior 00227 draft that wired both tags to the event helper only.
  old_dj_v1 text := $a$out_text := replace(out_text, '<dj_calendar_link>',
    xos_html_escape(public.xos_event_planning_meeting_url(e.id)));$a$;
  old_poc text := $a$out_text := replace(out_text, '<poc_planning_link>', xos_html_escape(poc.planning_meeting_url));$a$;
  new_poc text := $a$out_text := replace(out_text, '<poc_planning_link>',
    xos_html_escape(public.xos_event_planning_meeting_url(e.id)));$a$;
begin
  if position('xos_dj_planning_meeting_url(e.id)' in src) > 0
     and position(new_poc in src) > 0 then
    return; -- already applied
  end if;

  if position(old_dj in src) > 0 then
    if (length(src) - length(replace(src, old_dj, ''))) / length(old_dj) <> 1 then
      raise exception 'render_merge_tags: <dj_calendar_link> block is not unique';
    end if;
    src := replace(src, old_dj, new_dj);
  elsif position(old_dj_v1 in src) > 0 then
    if (length(src) - length(replace(src, old_dj_v1, ''))) / length(old_dj_v1) <> 1 then
      raise exception 'render_merge_tags: prior <dj_calendar_link> helper call is not unique';
    end if;
    src := replace(src, old_dj_v1, new_dj);
  elsif position(new_dj in src) = 0 then
    raise exception 'render_merge_tags: <dj_calendar_link> block not found — not patched';
  end if;

  if position(new_poc in src) = 0 then
    if position(old_poc in src) = 0 then
      raise exception 'render_merge_tags: <poc_planning_link> line not found — not patched';
    end if;
    if (length(src) - length(replace(src, old_poc, ''))) / length(old_poc) <> 1 then
      raise exception 'render_merge_tags: <poc_planning_link> line is not unique';
    end if;
    src := replace(src, old_poc, new_poc);
  end if;

  execute src; -- pg_get_functiondef returns CREATE OR REPLACE FUNCTION …
end
$mig$;
