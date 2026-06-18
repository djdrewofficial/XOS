-- XOS — Planner elevation: Host vs Guest roles, event cover photo, and the
-- "guest-answerable" section flag staff predetermine.
--
-- Roles:
--   HOST  = a client listed on the event (event_clients / events.client_id) → full planner.
--   GUEST = an event_guest the couple invited → can ONLY read & answer questions
--           in sections staff flagged guest_enabled. No songs, no other data.
--   STAFF = full access (and the no-account owner fallback).

-- Event cover photo (couple-uploaded hero image).
alter table events add column if not exists cover_photo_url text;

-- Staff-predetermined: may invited guests answer this section's questions?
alter table planning_sections          add column if not exists guest_enabled boolean not null default false;
alter table planning_template_sections add column if not exists guest_enabled boolean not null default false;

-- ───────────────────────── RLS helper functions ─────────────────────────

-- Host (or staff/owner): full access to an event's planning.
create or replace function xos_is_host(p_event_id uuid)
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
    );
$$;

-- Invited guest of an event.
create or replace function xos_guest_of(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from accounts a
    join event_guests g on g.id = a.event_guest_id
    where a.auth_user_id = auth.uid()
      and a.account_type = 'event_guest'
      and g.event_id = p_event_id
  );
$$;

-- Page-level "can see this event at all" = host or guest.
create or replace function xos_can_access_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select xos_is_host(p_event_id) or xos_guest_of(p_event_id);
$$;

-- ──────────────────── Rebuild planning RLS with the split ────────────────────

-- Sections: hosts see all; guests see only guest_enabled ones; staff restructure.
drop policy if exists "read sections"       on planning_sections;
drop policy if exists "staff write sections" on planning_sections;
create policy "host read sections" on planning_sections
  for select to authenticated using (xos_is_host(event_id));
create policy "guest read sections" on planning_sections
  for select to authenticated using (xos_guest_of(event_id) and guest_enabled);
create policy "staff write sections" on planning_sections
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());

-- Questions: hosts all; guests only within guest_enabled sections; staff write.
drop policy if exists "read questions"       on planning_questions;
drop policy if exists "staff write questions" on planning_questions;
create policy "host read questions" on planning_questions
  for select to authenticated using (xos_is_host(event_id));
create policy "guest read questions" on planning_questions
  for select to authenticated using (
    xos_guest_of(event_id)
    and exists (select 1 from planning_sections s
                where s.id = section_id and s.guest_enabled)
  );
create policy "staff write questions" on planning_questions
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());

-- Answers: hosts answer anything; guests answer only guest_enabled sections' Qs.
drop policy if exists "access answers" on planning_question_answers;
create policy "host answers" on planning_question_answers
  for all to authenticated
  using (xos_is_host(event_id)) with check (xos_is_host(event_id));
create policy "guest answers" on planning_question_answers
  for all to authenticated
  using (
    xos_guest_of(event_id)
    and exists (
      select 1 from planning_questions q
      join planning_sections s on s.id = q.section_id
      where q.id = question_id and s.guest_enabled
    )
  )
  with check (
    xos_guest_of(event_id)
    and exists (
      select 1 from planning_questions q
      join planning_sections s on s.id = q.section_id
      where q.id = question_id and s.guest_enabled
    )
  );

-- Songs, likes, song-ideas: HOSTS (and staff) only — guests never touch music.
drop policy if exists "access songs" on planning_songs;
create policy "host songs" on planning_songs
  for all to authenticated
  using (xos_is_host(event_id)) with check (xos_is_host(event_id));

drop policy if exists "access song likes" on planning_song_likes;
create policy "host song likes" on planning_song_likes
  for all to authenticated
  using (exists (select 1 from planning_songs s where s.id = song_id and xos_is_host(s.event_id)))
  with check (exists (select 1 from planning_songs s where s.id = song_id and xos_is_host(s.event_id)));

drop policy if exists "access song idea lists" on song_idea_lists;
create policy "host song idea lists" on song_idea_lists
  for all to authenticated
  using (xos_is_host(event_id)) with check (xos_is_host(event_id));

drop policy if exists "access song ideas" on song_ideas;
create policy "host song ideas" on song_ideas
  for all to authenticated
  using (xos_is_host(event_id)) with check (xos_is_host(event_id));

-- ──────────────────────── Event-photos storage bucket ────────────────────────
-- Public read (couple's cover image renders in the portal). Writes happen via the
-- service-role client in a server action after verifying host access, so no
-- storage write policies are needed.
insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', true)
on conflict (id) do nothing;

-- Demo: let invited guests help with the "Let's get started!" intro questions.
update planning_template_sections set guest_enabled = true where title = 'Let''s get started!';
update planning_sections          set guest_enabled = true where title = 'Let''s get started!';
