-- XOS — Conditional questions. A question can depend on another question's
-- answer: show it only when the controlling answer matches one of condition_values
-- (empty values + a set controller = "show once the controller is answered").
alter table planning_questions          add column if not exists condition_question_id uuid references planning_questions(id) on delete set null;
alter table planning_questions          add column if not exists condition_values      text[] not null default '{}';
alter table planning_template_questions add column if not exists condition_question_id uuid references planning_template_questions(id) on delete set null;
alter table planning_template_questions add column if not exists condition_values      text[] not null default '{}';

-- Demo on the Villa template: "If buffet, how would you like to release tables?"
-- only shows when "How will dinner be served?" = Buffet.
do $$
declare ctrl uuid; dep uuid;
begin
  select q.id into ctrl from planning_template_questions q
    join planning_template_sections s on s.id = q.template_section_id
    join planning_templates t on t.id = s.template_id
   where t.name = 'Villa Toscana — Wedding' and q.prompt = 'How will dinner be served?' limit 1;
  select q.id into dep from planning_template_questions q
    join planning_template_sections s on s.id = q.template_section_id
    join planning_templates t on t.id = s.template_id
   where t.name = 'Villa Toscana — Wedding' and q.prompt = 'If buffet, how would you like to release tables?' limit 1;
  if ctrl is not null and dep is not null then
    update planning_template_questions set condition_question_id = ctrl, condition_values = array['Buffet'] where id = dep;
  end if;
end $$;
