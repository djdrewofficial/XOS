-- XOS — Planner templates: per-event template assignment (incl. via booking
-- helper), image-option questions, an assets bucket, and the seeded
-- Villa Toscana wedding template structure.

-- Which template an event uses (chosen by a booking helper or staff). Overrides
-- the event-type / default fallback in ensureEventPlanning.
alter table events          add column if not exists planning_template_id uuid references planning_templates(id) on delete set null;
-- A booking helper can stamp this template onto an event when it runs.
alter table booking_helpers add column if not exists planning_template_id uuid references planning_templates(id) on delete set null;

-- Image-option question type (e.g. "Photo Booth Backdrop" — each choice has a
-- picture). Options jsonb holds [{label, image}] instead of plain strings.
alter table planning_questions          drop constraint if exists planning_questions_answer_type_check;
alter table planning_questions          add  constraint planning_questions_answer_type_check
  check (answer_type in ('short','long','select','multiselect','scale','yesno','image_select'));
alter table planning_template_questions drop constraint if exists planning_template_questions_answer_type_check;
alter table planning_template_questions add  constraint planning_template_questions_answer_type_check
  check (answer_type in ('short','long','select','multiselect','scale','yesno','image_select'));

-- Public bucket for reusable planning art (question option images, later
-- curated-playlist covers). Written via service-role in staff actions.
insert into storage.buckets (id, name, public)
values ('planning-assets', 'planning-assets', true)
on conflict (id) do nothing;

-- ───────────── Seed: Villa Toscana — Wedding template (structure) ─────────────
do $$
declare
  t_id   uuid;
  wed_id uuid;
  s_id   uuid;
begin
  if exists (select 1 from planning_templates where name = 'Villa Toscana — Wedding') then
    return;
  end if;
  select id into wed_id from event_types where lower(name) like '%wedding%' limit 1;

  insert into planning_templates (name, event_type_id, is_default)
  values ('Villa Toscana — Wedding', wed_id, false)
  returning id into t_id;

  -- Sections + headlines in display order (mirrors the Vibo export).
  insert into planning_template_sections
    (template_id, title, icon, section_type, songs_enabled, questions_enabled, song_limit, sort_order)
  values
    (t_id, 'Let''s Get Started!',                 '👋', 'headline', false, false, null, 0),
    (t_id, 'Wedding Details',                      '💍', 'info',     false, true,  null, 1),
    (t_id, 'About You',                            '💑', 'info',     false, true,  null, 2),
    (t_id, 'Epic Extras',                          '✨', 'info',     false, true,  null, 3),
    (t_id, 'Ceremony',                             '⛪', 'headline', false, false, null, 4),
    (t_id, 'Pre-Ceremony',                         '🎻', 'timeline', true,  true,  null, 5),
    (t_id, 'Ceremony Begins',                      '🔔', 'timeline', true,  true,  1,    6),
    (t_id, 'Wedding Party Processional (Enter)',   '🚶', 'timeline', true,  true,  null, 7),
    (t_id, 'Bridal Entrance',                      '👰', 'timeline', true,  true,  1,    8),
    (t_id, 'Ceremony Recessional (Exit)',          '🎉', 'timeline', true,  true,  1,    9),
    (t_id, 'Cocktail Hour',                        '🍸', 'headline', false, false, null, 10),
    (t_id, 'Cocktail Hour ',                       '🍸', 'timeline', true,  true,  null, 11),
    (t_id, 'Reception',                            '🥳', 'headline', false, false, null, 12),
    (t_id, 'Reception Begins',                     '🎊', 'timeline', true,  true,  null, 13),
    (t_id, 'Grandparents Entrance',                '👵', 'timeline', true,  true,  null, 14),
    (t_id, 'Bride''s Parent Entrance',             '👩', 'timeline', true,  true,  1,    15),
    (t_id, 'Groom''s Parent Entrance',             '👨', 'timeline', true,  true,  1,    16),
    (t_id, 'Wedding Party Introduction',           '💃', 'timeline', true,  true,  null, 17),
    (t_id, 'Newlyweds Grand Entrance',             '🎆', 'timeline', true,  true,  1,    18),
    (t_id, 'First Dance',                          '🕺', 'timeline', true,  true,  1,    19),
    (t_id, 'Parent/Step-Parent/Special Person Dance 1', '👨‍👧', 'timeline', true, true, 1, 20),
    (t_id, 'Parent/Step-Parent/Special Person Dance 2', '👩‍👦', 'timeline', true, true, 1, 21),
    (t_id, 'Blessing',                             '🙏', 'timeline', false, true,  null, 22),
    (t_id, 'Toasts/Speeches',                      '🥂', 'timeline', false, true,  null, 23),
    (t_id, 'Dinner Music',                         '🍽️', 'timeline', true,  true,  null, 24),
    (t_id, 'Cake Cutting',                         '🍰', 'timeline', true,  true,  1,    25),
    (t_id, 'Dancing',                              '🪩', 'headline', false, false, null, 26),
    (t_id, 'Open Dancing Music',                   '🎶', 'timeline', true,  true,  null, 27),
    (t_id, 'Must Play Dance Music',                '⭐', 'timeline', true,  true,  null, 28),
    (t_id, 'Slow Dance Songs',                     '💗', 'timeline', true,  true,  null, 29),
    (t_id, 'Last Dance (with guests)',             '🌙', 'timeline', true,  true,  1,    30),
    (t_id, 'Don''t Play',                          '🚫', 'timeline', true,  false, null, 31),
    (t_id, 'End Time',                             '🏁', 'info',     false, true,  null, 32);

  -- A few starter questions so the structure isn't empty. Drew fills the rest in
  -- the builder. Includes the image-option "Photo Booth Backdrop" example.
  select id into s_id from planning_template_sections where template_id = t_id and title = 'Wedding Details';
  insert into planning_template_questions (template_section_id, prompt, answer_type, sort_order) values
    (s_id, 'Wedding Planner / Coordinator (Name / Phone / Email)', 'short', 0),
    (s_id, 'Venue Contact (Name / Phone / Email)', 'short', 1),
    (s_id, 'Photographer (Name / Phone / Email)', 'short', 2),
    (s_id, 'What are your wedding colors or theme?', 'short', 3);

  select id into s_id from planning_template_sections where template_id = t_id and title = 'About You';
  insert into planning_template_questions (template_section_id, prompt, answer_type, sort_order) values
    (s_id, 'How did you two meet?', 'long', 0),
    (s_id, 'How many guests are you expecting?', 'short', 1),
    (s_id, 'Rate your crowd''s party level (1 = casual, 10 = loves to party!)', 'scale', 2);

  select id into s_id from planning_template_sections where template_id = t_id and title = 'Epic Extras';
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (s_id, 'Photo Booth Backdrop selection', 'image_select', '[]'::jsonb, 0),
    (s_id, 'Any other add-ons or special requests?', 'long', '[]'::jsonb, 1);
end $$;
