-- Fix blank planning-meeting buttons: <poc_planning_link> (used by
-- "We're Alive 6 (30 Days) (May 2025)") and <dj_calendar_link> must resolve to
-- the event's assigned DJ planning_meeting_url, falling back to Drew's public
-- booking link when that profile field is empty or no DJ is assigned.
--
-- CREATE OR REPLACE helpers hold the fallback URL in one place. render_merge_tags
-- is then CREATE OR REPLACEd from its live definition (through 00226 receipt tags
-- + financials-hidden / field-staff money blanking) with both tags wired to the
-- helper. Apply this migration after merge; do not apply from the PR agent.

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
  'Company fallback URL for DJ planning-meeting merge tags when the assigned DJ has none saved.';

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
      from event_staff es
      join employees em on em.id = es.employee_id
      where es.event_id = p_event_id
      order by (es.role ilike '%dj%') desc, em.stage_name nulls last, em.first_name
      limit 1
    )), ''),
    public.xos_default_planning_meeting_url()
  );
$fn$;

comment on function public.xos_event_planning_meeting_url(uuid) is
  'Assigned DJ planning_meeting_url for an event, or the company fallback when missing.';

revoke all on function public.xos_default_planning_meeting_url() from public, anon;
grant execute on function public.xos_default_planning_meeting_url() to authenticated, service_role;
revoke all on function public.xos_event_planning_meeting_url(uuid) from public, anon;
grant execute on function public.xos_event_planning_meeting_url(uuid) to authenticated, service_role;

update public.merge_tags
set description = 'The assigned DJ''s planning meeting / calendar link (falls back to the company booking link when empty).'
where tag_key in ('poc_planning_link', 'dj_calendar_link');

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
    xos_html_escape(public.xos_event_planning_meeting_url(e.id)));$a$;
  old_poc text := $a$out_text := replace(out_text, '<poc_planning_link>', xos_html_escape(poc.planning_meeting_url));$a$;
  new_poc text := $a$out_text := replace(out_text, '<poc_planning_link>',
    xos_html_escape(public.xos_event_planning_meeting_url(e.id)));$a$;
begin
  if position('xos_event_planning_meeting_url(e.id)' in src) > 0
     and position(new_poc in src) > 0 then
    return; -- already applied
  end if;

  if position(old_dj in src) = 0 then
    raise exception 'render_merge_tags: <dj_calendar_link> block not found — not patched';
  end if;
  if (length(src) - length(replace(src, old_dj, ''))) / length(old_dj) <> 1 then
    raise exception 'render_merge_tags: <dj_calendar_link> block is not unique';
  end if;
  src := replace(src, old_dj, new_dj);

  if position(old_poc in src) = 0 then
    raise exception 'render_merge_tags: <poc_planning_link> line not found — not patched';
  end if;
  if (length(src) - length(replace(src, old_poc, ''))) / length(old_poc) <> 1 then
    raise exception 'render_merge_tags: <poc_planning_link> line is not unique';
  end if;
  src := replace(src, old_poc, new_poc);

  execute src; -- pg_get_functiondef returns CREATE OR REPLACE FUNCTION …
end
$mig$;
