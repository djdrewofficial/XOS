-- XOS — Client Experience Planning ("Vibo replacement", phase 1: data model).
-- The in-house planner that lives under /portal. Mirrors Vibo 2.0:
--   Event → Sections (timeline moments + info sections)
--           → Songs   (picked via Spotify/Apple/YouTube search)
--           → Questions + Answers
--   Song Ideas (a per-event library/pool the couple builds up)
--   Templates  (reusable section+question sets, seeded per event type)
--
-- SECURITY: unlike the rest of XOS (blanket "authenticated full access"), these
-- tables are CLIENT-FACING, so they get real per-account RLS scoping from day one.
-- A client/guest may only touch planning rows for events they're attached to.
-- Staff (and the no-account owner fallback) get full access. Background jobs use
-- the service-role key, which bypasses RLS entirely.

-- ───────────────────────── RLS helper functions ─────────────────────────

-- True when the current login is staff (or has no account row → owner fallback).
create or replace function xos_is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from accounts a
    where a.auth_user_id = auth.uid()
      and a.account_type in ('client', 'event_guest')
  );
$$;

-- True when the current login may see/plan a given event: staff/owner always,
-- a client attached to the event (primary client or via event_clients), or an
-- event guest tied to that event.
create or replace function xos_can_access_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    xos_is_staff()
    or exists (
      select 1 from accounts a
      where a.auth_user_id = auth.uid()
        and a.account_type = 'client'
        and (
          exists (select 1 from event_clients ec
                  where ec.event_id = p_event_id and ec.client_id = a.client_id)
          or exists (select 1 from events e
                  where e.id = p_event_id and e.client_id = a.client_id)
        )
    )
    or exists (
      select 1 from accounts a
      join event_guests g on g.id = a.event_guest_id
      where a.auth_user_id = auth.uid()
        and a.account_type = 'event_guest'
        and g.event_id = p_event_id
    );
$$;

-- ───────────────────────────── Templates ─────────────────────────────
-- Staff-only. Cloned into an event's planning_sections when planning starts.

create table if not exists planning_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  event_type_id uuid references event_types(id) on delete set null,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists planning_template_sections (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references planning_templates(id) on delete cascade,
  title           text not null,
  icon            text,                          -- emoji shown on the section card
  section_type    text not null default 'timeline'
                    check (section_type in ('info', 'timeline')),
  intro           text,                          -- description at top of section
  time_label      text,                          -- e.g. "05:00 pm" (freeform display)
  client_editable boolean not null default true, -- may the couple add/remove songs?
  song_limit      int,                           -- null = unlimited (Vibo shows 19/20)
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists pts_template_idx on planning_template_sections(template_id);

create table if not exists planning_template_questions (
  id                  uuid primary key default gen_random_uuid(),
  template_section_id uuid not null references planning_template_sections(id) on delete cascade,
  prompt              text not null,
  help_text           text,
  answer_type         text not null default 'short'
                        check (answer_type in ('short','long','select','multiselect','scale','yesno')),
  options             jsonb not null default '[]'::jsonb,  -- for select/multiselect
  required            boolean not null default false,
  sort_order          int not null default 0
);
create index if not exists ptq_section_idx on planning_template_questions(template_section_id);

-- ─────────────────────── Per-event planning instance ───────────────────────

create table if not exists planning_sections (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  template_section_id uuid references planning_template_sections(id) on delete set null,
  title               text not null,
  icon                text,
  section_type        text not null default 'timeline'
                        check (section_type in ('info', 'timeline')),
  intro               text,
  time_label          text,
  client_editable     boolean not null default true,
  song_limit          int,
  locked              boolean not null default false,  -- DJ locks it close to event
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists ps_event_idx on planning_sections(event_id);

create table if not exists planning_questions (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references planning_sections(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  prompt      text not null,
  help_text   text,
  answer_type text not null default 'short'
                check (answer_type in ('short','long','select','multiselect','scale','yesno')),
  options     jsonb not null default '[]'::jsonb,
  required    boolean not null default false,
  sort_order  int not null default 0
);
create index if not exists pq_section_idx on planning_questions(section_id);
create index if not exists pq_event_idx on planning_questions(event_id);

create table if not exists planning_question_answers (
  question_id uuid primary key references planning_questions(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  answer      text,
  answered_by uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists pqa_event_idx on planning_question_answers(event_id);

create table if not exists planning_songs (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references planning_sections(id) on delete cascade,
  event_id     uuid not null references events(id) on delete cascade,
  provider     text not null default 'manual'
                 check (provider in ('spotify','apple','youtube','manual')),
  provider_id  text,            -- track id / video id within the provider
  isrc         text,            -- cross-provider match key when available
  title        text not null,
  artist       text,
  album        text,
  artwork_url  text,
  duration_ms  int,
  preview_url  text,
  external_url text,
  note         text,            -- dedication / "must play" / instructions
  requested_by uuid references auth.users(id) on delete set null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists psong_section_idx on planning_songs(section_id);
create index if not exists psong_event_idx on planning_songs(event_id);

create table if not exists planning_song_likes (
  song_id    uuid not null references planning_songs(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (song_id, account_id)
);

-- ───────────────────────────── Song Ideas ─────────────────────────────
-- A per-event library the couple builds; songs get pulled into sections later.

create table if not exists song_idea_lists (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  name       text not null default 'Song Ideas',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sil_event_idx on song_idea_lists(event_id);

create table if not exists song_ideas (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references song_idea_lists(id) on delete cascade,
  event_id     uuid not null references events(id) on delete cascade,
  provider     text not null default 'manual'
                 check (provider in ('spotify','apple','youtube','manual')),
  provider_id  text,
  isrc         text,
  title        text not null,
  artist       text,
  album        text,
  artwork_url  text,
  duration_ms  int,
  preview_url  text,
  external_url text,
  note         text,
  added_by     uuid references auth.users(id) on delete set null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists si_list_idx on song_ideas(list_id);
create index if not exists si_event_idx on song_ideas(event_id);

-- ───────────────────────────────── RLS ─────────────────────────────────

alter table planning_templates          enable row level security;
alter table planning_template_sections  enable row level security;
alter table planning_template_questions enable row level security;
alter table planning_sections           enable row level security;
alter table planning_questions          enable row level security;
alter table planning_question_answers   enable row level security;
alter table planning_songs              enable row level security;
alter table planning_song_likes         enable row level security;
alter table song_idea_lists             enable row level security;
alter table song_ideas                  enable row level security;

-- Templates: staff only (clients never see them).
do $$ begin
  create policy "staff manage templates" on planning_templates
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff manage template sections" on planning_template_sections
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff manage template questions" on planning_template_questions
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Sections / questions: anyone on the event can READ; only staff restructure.
do $$ begin
  create policy "read sections" on planning_sections
    for select to authenticated using (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write sections" on planning_sections
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "read questions" on planning_questions
    for select to authenticated using (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff write questions" on planning_questions
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Answers: anyone on the event reads & writes (the couple answers).
do $$ begin
  create policy "access answers" on planning_question_answers
    for all to authenticated
    using (xos_can_access_event(event_id)) with check (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;

-- Songs & likes & song-ideas: anyone on the event reads & writes.
do $$ begin
  create policy "access songs" on planning_songs
    for all to authenticated
    using (xos_can_access_event(event_id)) with check (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "access song likes" on planning_song_likes
    for all to authenticated
    using (exists (select 1 from planning_songs s
                   where s.id = song_id and xos_can_access_event(s.event_id)))
    with check (exists (select 1 from planning_songs s
                   where s.id = song_id and xos_can_access_event(s.event_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "access song idea lists" on song_idea_lists
    for all to authenticated
    using (xos_can_access_event(event_id)) with check (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "access song ideas" on song_ideas
    for all to authenticated
    using (xos_can_access_event(event_id)) with check (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;

-- ────────────────────── Seed: default Wedding template ──────────────────────
-- Gives every event something to plan against on first open. Mirrors the Vibo
-- wedding flow (a "Let's get started" info section + timeline moments).

do $$
declare
  t_id   uuid;
  wed_id uuid;
  s_id   uuid;
begin
  if exists (select 1 from planning_templates where is_default) then
    return;  -- already seeded
  end if;

  select id into wed_id from event_types where lower(name) like '%wedding%' limit 1;

  insert into planning_templates (name, event_type_id, is_default)
  values ('Wedding — Standard', wed_id, true)
  returning id into t_id;

  -- 1) Let's get started! (info / questions only)
  insert into planning_template_sections (template_id, title, icon, section_type, intro, sort_order)
  values (t_id, 'Let''s get started!', '👋', 'info',
          'Tell us about your big day so we can program the perfect night.', 0)
  returning id into s_id;
  insert into planning_template_questions (template_section_id, prompt, answer_type, options, sort_order) values
    (s_id, 'How many guests will be attending?', 'short', '[]', 0),
    (s_id, 'What is the age range of your guests?', 'short', '[]', 1),
    (s_id, 'Will there be children at the reception?', 'yesno', '[]', 2),
    (s_id, 'Rate your crowd''s party level (1 = casually social, 10 = loves to party!)', 'scale', '[]', 3),
    (s_id, 'How interactive do you want your DJ/MC?', 'long', '[]', 4),
    (s_id, 'What are your wedding colors or theme?', 'short', '[]', 5),
    (s_id, 'Are there any songs or genres you do NOT want played?', 'long', '[]', 6);

  -- 2) Grand Entrance
  insert into planning_template_sections (template_id, title, icon, section_type, intro, sort_order, song_limit)
  values (t_id, 'Grand Entrance', '🎉', 'timeline',
          'The song(s) for the wedding party and couple entrance.', 1, 3)
  returning id into s_id;
  insert into planning_template_questions (template_section_id, prompt, answer_type, sort_order) values
    (s_id, 'In what order should the wedding party be introduced?', 'long', 0);

  -- 3) Cocktail Hour
  insert into planning_template_sections (template_id, title, icon, section_type, intro, sort_order, time_label)
  values (t_id, 'Cocktail Hour', '🍸', 'timeline',
          'Cocktail hour begins immediately after the ceremony.', 2, '05:00 pm');

  -- 4) Dinner
  insert into planning_template_sections (template_id, title, icon, section_type, intro, sort_order)
  values (t_id, 'Dinner', '🍽️', 'timeline', 'Background music while guests dine.', 3);

  -- 5) First Dance
  insert into planning_template_sections (template_id, title, icon, section_type, sort_order, song_limit)
  values (t_id, 'First Dance', '💃', 'timeline', 4, 1);

  -- 6) Parent Dances
  insert into planning_template_sections (template_id, title, icon, section_type, sort_order, song_limit)
  values (t_id, 'Parent Dances', '👨‍👩‍👧', 'timeline', 5, 2);

  -- 7) Open Dancing
  insert into planning_template_sections (template_id, title, icon, section_type, intro, sort_order)
  values (t_id, 'Open Dancing', '🕺', 'timeline',
          'Your must-play dance floor songs — load it up!', 6);

  -- 8) Last Song
  insert into planning_template_sections (template_id, title, icon, section_type, sort_order, song_limit)
  values (t_id, 'Last Song', '🌙', 'timeline', 7, 1);
end $$;
