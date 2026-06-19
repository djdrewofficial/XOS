-- Hierarchical music-genre options for the "What music genres do you love?"
-- question. Parent genres reveal sub-genres in the app (Latin → Salsa,
-- Reggaeton, …). Stored in the question's options jsonb as
-- [{ "label": "Latin", "children": ["Salsa", ...] }, ...] — a future settings
-- editor can manage these trees; for now we seed the music one.

do $$
declare
  genres jsonb := '[
    {"label":"Top 40 / Pop","children":["Current Hits","2010s Pop","Throwback Pop","Dance Pop"]},
    {"label":"Hip-Hop / Rap","children":["Old School","90s & 2000s","Trap","Drill"]},
    {"label":"R&B / Soul","children":["Classic Soul / Motown","90s R&B","Neo-Soul","Current R&B"]},
    {"label":"Latin","children":["Salsa","Bachata","Merengue","Reggaeton","Cumbia","Latin Pop","Regional Mexican"]},
    {"label":"Caribbean","children":["Reggae","Dancehall","Soca","Calypso"]},
    {"label":"Afrobeats / African","children":["Afrobeats","Amapiano","Afro-House"]},
    {"label":"Country","children":["Classic Country","Modern Country","Country Pop"]},
    {"label":"Rock","children":["Classic Rock","Alternative","Pop-Punk","Indie"]},
    {"label":"Electronic / Dance","children":["House","EDM / Festival","Techno","Disco / Funk"]},
    {"label":"Throwback / Oldies","children":["Motown","70s","80s","90s","2000s"]},
    {"label":"Jazz / Standards","children":["Jazz","Swing","Lounge"]},
    {"label":"Gospel / Christian","children":[]},
    {"label":"Bollywood / Desi","children":["Bollywood","Bhangra"]},
    {"label":"Ballroom","children":["Waltz","Foxtrot","Cha-Cha"]}
  ]'::jsonb;
begin
  update planning_template_questions set options = genres where prompt = 'What music genres do you love?';
  update planning_questions          set options = genres where prompt = 'What music genres do you love?';
end $$;
