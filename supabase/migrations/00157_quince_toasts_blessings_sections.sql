-- Quince Party template — add the two sections under the "Toasts & Blessings"
-- headline (from the live Vibo template): "Blessing" and "Toasts/Speeches".
-- Idempotent: no-op if "Blessing" already exists on the template.

do $$
declare
  t_id     uuid;
  h_order  int;
  s_bless  uuid;
  s_toasts uuid;
begin
  select id into t_id from planning_templates where name = 'Quince Party' limit 1;
  if t_id is null then return; end if;
  if exists (select 1 from planning_template_sections
             where template_id = t_id and title = 'Blessing') then
    return;
  end if;

  select sort_order into h_order from planning_template_sections
    where template_id = t_id and title = 'Toasts & Blessings' and section_type = 'headline'
    limit 1;
  if h_order is null then return; end if;

  -- Make room directly under the "Toasts & Blessings" headline.
  update planning_template_sections
     set sort_order = sort_order + 2
   where template_id = t_id and sort_order > h_order;

  insert into planning_template_sections
    (template_id, title, icon, section_type, intro, songs_enabled, questions_enabled, sort_order)
  values (t_id, 'Blessing', '🎤', 'info', 'Blessing the evening and meal.', false, true, h_order + 1)
  returning id into s_bless;

  insert into planning_template_sections
    (template_id, title, icon, section_type, intro, songs_enabled, questions_enabled, sort_order)
  values (t_id, 'Toasts/Speeches', '🎤', 'info',
          'Toasts are a fantastic way to start dinner and offer some entertainment during the meal. If there will be over three speakers, it''s advised to limit toasts to approximately 5 minutes or less per speaker.',
          false, true, h_order + 2)
  returning id into s_toasts;

  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (s_bless, 'Will you be having a blessing before dinner?', 'yesno', '[]'::jsonb, 0),
    (s_bless, 'Who will be giving the blessing?',            'short', '[]'::jsonb, 1);

  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (s_toasts, 'List toasters (in order) and their relationship to the Quince.',      'long',  '[]'::jsonb, 0),
    (s_toasts, 'Would you like to include a ''Thank You'' at the end of the toasts?', 'yesno', '[]'::jsonb, 1),
    (s_toasts, 'Will there be a specialty drink for toasts?',                          'select',
       '["Yes.", "No. Whatever they grab from the bar or have at their table is fine."]'::jsonb, 2);
end $$;
