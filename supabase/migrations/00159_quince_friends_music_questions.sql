-- Quince Party template — "Quinceañera & Friends Music Song Requests" section
-- questions (from the live Vibo template): clean-edits preference + group dances.
-- Idempotent: no-op if the section already has these questions.

do $$
declare
  t_id uuid;
  sec  uuid;
begin
  select id into t_id from planning_templates where name = 'Quince Party' limit 1;
  if t_id is null then return; end if;

  select id into sec from planning_template_sections
    where template_id = t_id and title = 'Quinceañera & Friends Music Song Requests' limit 1;
  if sec is null then return; end if;

  if exists (select 1 from planning_template_questions
             where template_section_id = sec and prompt = 'Do you need clean edits of music played?') then
    return;
  end if;

  insert into planning_template_questions
    (template_section_id, prompt, answer_type, options, sort_order)
  values
    (sec, 'Do you need clean edits of music played?', 'select',
       '["Yes, clean versions ONLY.","No. We do not need clean versions played.","We prefer clean versions, but are ok with original songs if needed."]'::jsonb, 0),
    (sec, 'Would you like any group dances? Please check all that apply.', 'multiselect',
       '["Cupid Shuffle","Wobble","The Git Up","Electric-Slide","Watch Me (Whip / Nae Nae)","Cotton-Eyed Joe","The Cha Cha Slide","The YMCA","Shout","Macarena","Gangnam Style","Only if requested.","Absolutely not!","Other"]'::jsonb, 1);
end $$;
