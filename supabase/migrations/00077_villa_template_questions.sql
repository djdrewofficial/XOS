-- XOS — Populate the "Villa Toscana — Wedding" planning template with the real
-- questions from Drew's filled Vibo export (Lina & Mario). Reshapes the intro
-- area to a single "Let's get started!" section + a "Your Photo-booth Xperience"
-- section (backdrop image picker left empty for Drew), and loads per-section
-- questions across Ceremony / Cocktail / Reception / Dancing.
do $$
declare
  t_id  uuid;
  ws_id uuid;   -- Let's get started!
  pb_id uuid;   -- Photo-booth
  v_id  uuid;   -- scratch per-section
begin
  select id into t_id from planning_templates where name = 'Villa Toscana — Wedding' limit 1;
  if t_id is null then return; end if;
  -- Idempotency: this rename only exists after a prior run.
  if exists (select 1 from planning_template_sections where template_id = t_id and title = 'Let''s get started!') then
    return;
  end if;

  -- ── Intro area: collapse Wedding Details/About You/Epic Extras to match Vibo ──
  -- Wedding Details → "Let's get started!"
  select id into ws_id from planning_template_sections where template_id = t_id and title = 'Wedding Details' limit 1;
  if ws_id is not null then
    update planning_template_sections set title = 'Let''s get started!', icon = '👋', songs_enabled = false where id = ws_id;
    delete from planning_template_questions where template_section_id = ws_id;
    insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
      (ws_id, 'What year(s) did you both graduate high school?', 'short', '[]', 0),
      (ws_id, 'What is the age range of your guests? This helps your DJ program music for your reception.', 'short', '[]', 1),
      (ws_id, 'Will there be children at the reception?', 'yesno', '[]', 2),
      (ws_id, 'How many guests will be attending?', 'short', '[]', 3),
      (ws_id, 'Rate your crowd''s party level on a scale of 1-10. (1) Casually Social / (10) Loves to party and dance!', 'scale', '[]', 4),
      (ws_id, 'How interactive do you want your DJ/MC?', 'long', '[]', 5),
      (ws_id, 'What are your wedding colors or theme?', 'short', '[]', 6),
      (ws_id, 'Are you using any social media hashtags?', 'short', '[]', 7),
      (ws_id, 'Venue Contact (Name/Phone/E-mail)', 'short', '[]', 8),
      (ws_id, 'Caterer/Food Contact (Name/Phone/E-mail)', 'short', '[]', 9),
      (ws_id, 'Wedding Planner/Coordinator (Name/Phone/E-mail)', 'short', '[]', 10),
      (ws_id, 'Officiant (Name/Phone/E-mail)', 'short', '[]', 11),
      (ws_id, 'Photographer (Name/Phone/E-mail)', 'short', '[]', 12),
      (ws_id, 'Videographer (Name/Phone/E-mail)', 'short', '[]', 13),
      (ws_id, 'How late is your Photographer and/or Videographer scheduled?', 'short', '[]', 14),
      (ws_id, 'What are your expectations of the DJ?', 'long', '[]', 15),
      (ws_id, 'Is there anyone photosensitive to flashing/strobing lights that may be used during dancing?', 'short', '[]', 16),
      (ws_id, 'Any additional notes or information your DJ should know?', 'long', '[]', 17),
      (ws_id, 'Can we video blog to use on social media?', 'yesno', '[]', 18),
      (ws_id, 'What concerts have you attended together?', 'short', '[]', 19);
  end if;

  -- About You → removed (its questions live in "Let's get started!" now)
  delete from planning_template_sections where template_id = t_id and title = 'About You';

  -- Epic Extras → "Your Photo-booth Xperience" (keep the backdrop image picker)
  select id into pb_id from planning_template_sections where template_id = t_id and title = 'Epic Extras' limit 1;
  if pb_id is not null then
    update planning_template_sections set title = 'Your Photo-booth Xperience', icon = '📸' where id = pb_id;
    delete from planning_template_questions
      where template_section_id = pb_id and prompt = 'Any other add-ons or special requests?';
    update planning_template_questions set prompt = 'Choose Your Backdrop'
      where template_section_id = pb_id and prompt = 'Photo Booth Backdrop selection';
  end if;

  -- ── Ceremony ──
  select id into v_id from planning_template_sections where template_id = t_id and title = 'Pre-Ceremony' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'What time are your guests arriving? Normally guests show up 30 minutes before.', 'short', '[]', 0),
    (v_id, 'What type of music are you having at your ceremony?', 'short', '[]', 1),
    (v_id, 'Where is your ceremony?', 'short', '[]', 2),
    (v_id, 'What is the location of your Ceremony? Please provide an address if the Ceremony is at a site other than the reception address (like a church or off-site location).', 'long', '[]', 3),
    (v_id, 'If you are having an outdoor ceremony, what is your rain plan?', 'long', '[]', 4),
    (v_id, 'Would you like to have a wireless microphone available for your vows or keep them more private/intimate?', 'long', '[]', 5),
    (v_id, 'Besides the officiant, are you having any other speakers? For example, a poem reading, scripture reading, etc. If so, who are they, and how many other speakers will there be?', 'long', '[]', 6),
    (v_id, 'Are there any unique elements incorporated into your ceremony that your DJ should know about?', 'long', '[]', 7),
    (v_id, 'What type of music would you like the DJ to play while guests arrive? You can select your own specific songs or let the DJ choose based on your preferences below.', 'multiselect', '["Soft Pop/Love song (w/lyrics)","Soft Pop/Love song (instrumentals)"]', 8);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Ceremony Begins' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'What time is your ceremony scheduled to begin?', 'short', '[]', 0);

  -- ── Cocktail Hour (timeline section has a trailing space in its title) ──
  select id into v_id from planning_template_sections where template_id = t_id and section_type = 'timeline' and title ilike 'Cocktail Hour%' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Will you be having a cocktail hour?', 'yesno', '[]', 0),
    (v_id, 'Is the Cocktail Hour in the same room as the main reception? If not, where will it be taking place?', 'long', '[]', 1),
    (v_id, 'If you are having your cocktail hour outside, what is your rain plan?', 'long', '[]', 2),
    (v_id, 'What type of music are you having at your cocktail hour?', 'short', '[]', 3),
    (v_id, 'Is there power available where the cocktail hour is being held?', 'yesno', '[]', 4),
    (v_id, 'If you don''t have specific song requests, what type of vibe/genres would you like to hear? Select all that apply.', 'short', '[]', 5);

  -- ── Reception ──
  select id into v_id from planning_template_sections where template_id = t_id and title = 'Reception Begins' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'What time is your reception scheduled to begin?', 'short', '[]', 0);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Bride''s Parent Entrance' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'How would you like your parent(s) introduced?', 'short', '[]', 0),
    (v_id, 'Please enter your step-parent(s) names below. It''s appropriate to include their spouses as well in their introductions.', 'short', '[]', 1);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Groom''s Parent Entrance' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'How would you like your parent(s) introduced?', 'short', '[]', 0),
    (v_id, 'Please enter your step-parent(s) names below. It''s appropriate to include their spouses as well in the introduction.', 'short', '[]', 1);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Wedding Party Introduction' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'How would you like your wedding party to be introduced?', 'short', '[]', 0),
    (v_id, 'Please check which format you''d like for Wedding Party introductions.', 'long', '[]', 1),
    (v_id, 'Please write the Wedding Party''s names and song choices here.', 'long', '[]', 2);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'First Dance' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Would you like to dance to the entire song or have the DJ fade out when appropriate?', 'select', '["Entire song","Fade out when appropriate"]', 0),
    (v_id, 'Would you like anyone to join you on the dancefloor halfway through your first dance? Please note the layout of the venue and other factors may not allow for this. Your DJ will discuss with you if needed.', 'long', '[]', 1);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Parent/Step-Parent/Special Person Dance 1' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Who will you be dancing with? (Name and Relationship to you)', 'short', '[]', 0),
    (v_id, 'Would you like to dance to the entire song or have the DJ fade out when appropriate?', 'select', '["Entire song","Fade out when appropriate"]', 1),
    (v_id, 'If there is a step-parent or additional special someone, do you want them to finish off this dance halfway through?', 'yesno', '[]', 2);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Parent/Step-Parent/Special Person Dance 2' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Who will you be dancing with? (Name and Relationship to you)', 'short', '[]', 0),
    (v_id, 'Would you like to dance to the entire song or have the DJ fade out when appropriate?', 'select', '["Entire song","Fade out when appropriate"]', 1),
    (v_id, 'If there is a step-parent or additional special someone, do you want them to finish off this dance halfway through?', 'yesno', '[]', 2);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Grandparents Entrance' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Would you prefer to acknowledge the grandparents from their table or have them walk in with the wedding party?', 'long', '[]', 0),
    (v_id, 'How would you like them introduced? Please indicate your relation to them and how to pronounce their names.', 'long', '[]', 1);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Toasts/Speeches' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'List toasters (in order) and their relationship to the couple.', 'long', '[]', 0),
    (v_id, 'Would you like to include a ''Thank You'' at the end of the toasts?', 'yesno', '[]', 1),
    (v_id, 'Will there be a specialty drink for toasts?', 'yesno', '[]', 2);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Blessing' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Will you be having a blessing before dinner?', 'yesno', '[]', 0);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Dinner Music' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Will the DJ be providing dinner music for your reception or will you have live musicians?', 'select', '["DJ","Live musicians","Both"]', 0),
    (v_id, 'If you don''t have specific song requests, what type of vibe/genres would you like to hear? Select all that apply.', 'short', '[]', 1),
    (v_id, 'How will dinner be served?', 'select', '["Plated","Buffet","Family Style","Stations"]', 2),
    (v_id, 'If buffet, how would you like to release tables?', 'short', '[]', 3),
    (v_id, 'Will a meal be provided for the DJ?', 'yesno', '[]', 4),
    (v_id, 'Any announcements or reminders for the DJ? (Birthdays, Anniversaries, Guest Shout-outs)', 'long', '[]', 5);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Cake Cutting' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Do you prefer the DJ to announce your Cake Cutting or keep it private? Private arrangements are becoming more popular.', 'select', '["Announce it","Keep it private"]', 0),
    (v_id, 'Are there any other desserts that need to be announced?', 'short', '[]', 1);

  -- ── Dancing ──
  select id into v_id from planning_template_sections where template_id = t_id and title = 'Open Dancing Music' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Do you need clean edits of music played?', 'yesno', '[]', 0),
    (v_id, 'Would you like any group dances? Please check all that apply.', 'multiselect', '["Cha Cha Slide","Cupid Shuffle","Macarena","Wobble","Electric Slide","Conga Line"]', 1),
    (v_id, 'What type of music do you like to party to?', 'short', '[]', 2),
    (v_id, 'Are guests allowed to make music requests?', 'short', '[]', 3);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Slow Dance Songs' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Do you want a few slow songs played throughout the evening?', 'short', '[]', 0);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Last Dance (with guests)' limit 1;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Would you like to have a private dance once everyone leaves?', 'yesno', '[]', 0);

  select id into v_id from planning_template_sections where template_id = t_id and title = 'Don''t Play' limit 1;
  update planning_template_sections set questions_enabled = true where id = v_id;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (v_id, 'Is there any artist you don''t want to hear? If so, list them below.', 'long', '[]', 0),
    (v_id, 'Are there any genres you don''t want to hear? If so, list them below.', 'long', '[]', 1),
    (v_id, 'If your DO NOT PLAY songs are requested during the event, should your DJ play them?', 'yesno', '[]', 2);
end $$;
