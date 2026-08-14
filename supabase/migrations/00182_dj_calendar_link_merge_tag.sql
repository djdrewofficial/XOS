-- <dj_calendar_link>: the assigned DJ's booking/calendar link for the event (their
-- planning_meeting_url). Picks the same primary DJ as <djemployee1_*> (DJ-role first).
insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values ('dj_calendar_link', 'DJ Calendar Link', 'Staff',
        'The assigned DJ''s booking/calendar link (their Planning Meeting URL)', 'builtin', null, true, true)
on conflict (tag_key) do update
  set label = excluded.label, group_name = excluded.group_name, description = excluded.description,
      source_type = 'builtin', is_builtin = true, is_active = true;

do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));$a$;
  addition text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));
  if position('<dj_calendar_link>' in out_text) > 0 then
    out_text := replace(out_text, '<dj_calendar_link>', xos_html_escape(coalesce((
      select em.planning_meeting_url
      from event_staff es join employees em on em.id = es.employee_id
      where es.event_id = e.id
      order by (es.role ilike '%dj%') desc, em.stage_name nulls last, em.first_name
      limit 1
    ), '')));
  end if;$a$;
begin
  if position('<dj_calendar_link>' in src) > 0 then return; end if;
  if strpos(src, anchor) = 0 then raise exception 'render_merge_tags: <current_date> anchor not found'; end if;
  execute replace(src, anchor, addition);
end $mig$;
