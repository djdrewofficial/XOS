-- Quince Party template — Dinner Music section questions (from the live Vibo
-- template), including the buffet-conditional "release tables" question.
-- Idempotent: no-op if the section already has these questions.

do $$
declare
  t_id     uuid;
  sec      uuid;
  q_served uuid;
begin
  select id into t_id from planning_templates where name = 'Quince Party' limit 1;
  if t_id is null then return; end if;

  select id into sec from planning_template_sections
    where template_id = t_id and title = 'Dinner Music' limit 1;
  if sec is null then return; end if;

  if exists (select 1 from planning_template_questions
             where template_section_id = sec and prompt = 'How will dinner be served?') then
    return;
  end if;

  -- Section note + icon to match the Vibo template.
  update planning_template_sections
     set icon = '🎹',
         intro = 'This is a great time to fit in songs you love that aren''t dancefloor-friendly.'
   where id = sec;

  insert into planning_template_questions
    (template_section_id, prompt, answer_type, options, sort_order)
  values
    (sec, 'Will the DJ be providing dinner music for your reception or will you have live musicians?',
       'multiselect', '["DJ", "Live Music", "Both"]'::jsonb, 0),
    (sec, 'If you don''t have specific song requests, what type of vibe/genres would you like to hear? Select all that apply.',
       'multiselect',
       '["Modern Pop","Love Songs","Soft Rock/Alternative","Oldies/Motown","Modern Jazz","Soft R&B","Country ballads/love songs","Rat Pack","Yacht Rock","Upbeat Sing-A Long","Indy Rock","Mellow House/Chill Electronic","DJs Choice/Mix it Up","Other"]'::jsonb, 1);

  insert into planning_template_questions
    (template_section_id, prompt, answer_type, options, sort_order)
  values
    (sec, 'How will dinner be served?', 'select',
       '["Buffet / Food Stations","Served/Plated","Food Truck","Family Style"]'::jsonb, 2)
  returning id into q_served;

  insert into planning_template_questions
    (template_section_id, prompt, answer_type, options, condition_question_id, condition_values, sort_order)
  values
    (sec, 'If buffet, how would you like to release tables?', 'multiselect',
       '["Wait staff handles it. Tables released individually. Preferred method.","Release everyone simultaneously.","Other"]'::jsonb,
       q_served, array['Buffet / Food Stations'], 3);

  insert into planning_template_questions
    (template_section_id, prompt, answer_type, sort_order)
  values
    (sec, 'Any announcements or reminders for the DJ? (Birthdays, Anniversaries, Guest Shout-outs)', 'long', 4);
end $$;
