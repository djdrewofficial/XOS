-- Quince Party template — add the two "Start Here" question sections that the
-- Vibo PDF export left off its (blank) Section Details page: "Event Details"
-- and "Tell us your vibe!". Patches DBs that already ran 00155.
-- Idempotent: no-op if "Event Details" already exists on the template.

do $$
declare
  t_id    uuid;
  s_event uuid;
  s_vibe  uuid;
begin
  select id into t_id from planning_templates where name = 'Quince Party' limit 1;
  if t_id is null then return; end if;
  if exists (select 1 from planning_template_sections
             where template_id = t_id and title = 'Event Details') then
    return;
  end if;

  -- Make room directly under the "Start Here" headline (sort_order 0).
  update planning_template_sections
     set sort_order = sort_order + 2
   where template_id = t_id and sort_order >= 1;

  insert into planning_template_sections
    (template_id, title, icon, section_type, songs_enabled, questions_enabled, sort_order)
  values (t_id, 'Event Details', '📋', 'info', false, true, 1)
  returning id into s_event;

  insert into planning_template_sections
    (template_id, title, icon, section_type, songs_enabled, questions_enabled, sort_order)
  values (t_id, 'Tell us your vibe!', '✨', 'info', false, true, 2)
  returning id into s_vibe;

  insert into planning_template_questions (template_section_id, prompt, answer_type, sort_order) values
    (s_event, 'What time does your celebration start?',          'short', 0),
    (s_event, 'How many guests will be in attendance?',          'short', 1),
    (s_event, 'Will the celebration be mostly adults or teens?', 'short', 2);

  insert into planning_template_questions (template_section_id, prompt, answer_type, sort_order) values
    (s_vibe, 'What Latin flavors or cultural roots inspire your style? (Cuba, Dominican, Colombia, etc.)', 'short', 0);
end $$;
