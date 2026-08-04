-- XOS Planner — "Quince Party" template (structure).
--
-- Mirrors the Vibo "Family Garrido´s Quince" shared template (Drew's PDF export):
-- a Quinceañera reception timeline grouped by headline dividers, with a song
-- section for each moment. Single-song moments (grand entrances, spotlight
-- dances, last dance) are capped at song_limit 1; playlist sections are
-- unlimited. "Don't Play" holds songs but takes no questions.
--
-- The section questions live in follow-up migrations: 00156 (Start Here) and
-- 00157 (Toasts & Blessings) — the Vibo PDF's "Section Details" page was blank,
-- so the questions were transcribed from the live template afterward.
--
-- Idempotent: skips entirely if a "Quince Party" template already exists.

do $$
declare
  t_id uuid;
  q_id uuid;  -- the "Quince" event type (renamed from Quinceanera in 00090)
begin
  if exists (select 1 from planning_templates where name = 'Quince Party') then
    return;
  end if;

  select id into q_id from event_types where name = 'Quince' limit 1;

  insert into planning_templates (name, event_type_id, is_default)
  values ('Quince Party', q_id, false)
  returning id into t_id;

  -- Sections + headline dividers in display order (mirrors the Vibo timeline).
  -- Headlines carry no songs/questions; timeline sections do.
  insert into planning_template_sections
    (template_id, title, icon, section_type, songs_enabled, questions_enabled, song_limit, sort_order)
  values
    (t_id, 'Start Here',                                  '👋', 'headline', false, false, null, 0),

    (t_id, 'Cocktail Hour',                               '🍸', 'headline', false, false, null, 1),
    (t_id, 'Guest Arrival / Cocktail Hour',               '🥂', 'timeline', true,  true,  null, 2),

    (t_id, 'Grand Entrances',                             '🎉', 'headline', false, false, null, 3),
    (t_id, 'Parents Grand Entrance',                      '👫', 'timeline', true,  true,  1,    4),
    (t_id, 'Padrinos Grand Entrance',                     '🤝', 'timeline', true,  true,  1,    5),
    (t_id, 'Court of Honor Grand Entrance',               '👑', 'timeline', true,  true,  1,    6),
    (t_id, 'Quinceañera Grand Entrance',                  '👸', 'timeline', true,  true,  1,    7),

    (t_id, 'Special Dances',                              '💗', 'headline', false, false, null, 8),
    (t_id, 'Father Daughter Dance',                       '👨‍👧', 'timeline', true, true,  1,    9),
    (t_id, 'Mother-Daughter Dance',                       '👩‍👧', 'timeline', true, true,  1,    10),
    (t_id, 'Other Special Dances',                        '💃', 'timeline', true,  true,  null, 11),
    (t_id, 'Don''t Play',                                 '🚫', 'timeline', true,  false, null, 12),

    (t_id, 'Toasts & Blessings',                          '🥂', 'headline', false, false, null, 13),

    (t_id, 'Dinner Time',                                 '🍽️', 'headline', false, false, null, 14),
    (t_id, 'Dinner Music',                                '🎼', 'timeline', true,  true,  null, 15),

    (t_id, 'Party Time / Dancing',                        '🪩', 'headline', false, false, null, 16),
    (t_id, 'Quinceañera & Friends Music Song Requests',   '💃', 'timeline', true,  true,  null, 17),
    (t_id, 'Adult / Parents Music Requests',              '💃', 'timeline', true,  true,  null, 18),
    (t_id, 'Last Dance (with guests)',                    '🌙', 'timeline', true,  true,  1,    19);
end $$;
