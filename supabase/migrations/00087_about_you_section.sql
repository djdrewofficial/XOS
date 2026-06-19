-- "Tell us about you" planner section — collects the couple's story, cultural
-- influences, and favorite genres. This is what powers the app's "For You"
-- song picks. Added to the Villa Toscana template's "Let's Get Started" group
-- (sort 3, between Vendor Team and the Ceremony headline) and backfilled onto
-- existing events seeded from that template.
--
-- Prompts are worded so the app's recommendation context picker matches them
-- (about-us / cultural / genre keywords).

do $$
declare
  v_template uuid := 'c223bbfa-d7b3-4f25-b7b7-5ced36ec7557';
  v_tsec uuid;
  r_event record;
  v_sec uuid;
  v_intro text := 'Tell us a bit about you two — your story and the music you love. This is what powers your personalized song picks ("For You").';
begin
  select id into v_tsec from planning_template_sections
    where template_id = v_template and title = 'Tell us about you';

  if v_tsec is null then
    insert into planning_template_sections
      (template_id, title, icon, section_type, intro, songs_enabled, questions_enabled, sort_order)
    values (v_template, 'Tell us about you', '💜', 'info', v_intro, false, true, 3)
    returning id into v_tsec;

    insert into planning_template_questions (template_section_id, prompt, help_text, answer_type, options, sort_order) values
      (v_tsec, 'Tell us about you as a couple — how you met, your story, your vibe.', 'A few sentences is perfect.', 'long', '[]'::jsonb, 0),
      (v_tsec, 'Any cultural influences, heritage, or traditions we should weave into your music?', 'Languages, countries, family traditions, must-play cultural songs…', 'long', '[]'::jsonb, 1),
      (v_tsec, 'What music genres do you love?', 'Pick all that apply — this guides your For You picks.', 'multiselect',
        '["Top 40 / Pop","Hip-Hop / Rap","R&B","Latin","Reggaeton","Afrobeats","Caribbean / Soca","Country","Rock","EDM / House","Motown / Oldies","Jazz","Reggae","Gospel","Bollywood / Desi"]'::jsonb, 2),
      (v_tsec, 'Any favorite artists or songs that are "so you two"?', null, 'long', '[]'::jsonb, 3);
  end if;

  -- Backfill events already seeded from this template that don't have it yet.
  for r_event in
    select e.id from events e
    where e.planning_template_id = v_template
      and not exists (
        select 1 from planning_sections ps where ps.event_id = e.id and ps.template_section_id = v_tsec
      )
  loop
    insert into planning_sections
      (event_id, template_section_id, title, icon, section_type, intro, songs_enabled, questions_enabled, sort_order)
    values (r_event.id, v_tsec, 'Tell us about you', '💜', 'info', v_intro, false, true, 3)
    returning id into v_sec;

    insert into planning_questions (section_id, event_id, prompt, help_text, answer_type, options, sort_order)
    select v_sec, r_event.id, prompt, help_text, answer_type, options, sort_order
    from planning_template_questions where template_section_id = v_tsec;
  end loop;
end $$;
