-- Notes on a planning moment (one planning_sections row).
--
-- client_notes lives on planning_sections so anyone who can already read that
-- section reads it too: the couple (host read), guests with planning access
-- (guest read, which is guest_enabled), and staff (host read includes staff via
-- xos_is_host). Song/answer edits today are "your own event" via xos_is_host.
-- planning_sections itself is staff-write ("staff write sections"), so hosts
-- could not update a column on it. This adds an UPDATE policy for hosts of
-- that event and a BEFORE UPDATE trigger that refuses every column except
-- client_notes unless the caller is staff or a privileged role (service_role /
-- postgres). Staff and clients share the Postgres role `authenticated`, so a
-- column GRANT cannot tell them apart — revoking table UPDATE would also block
-- staff from saving section settings with their own JWT.
--
-- Staff-only notes are a separate table with no client or guest policy.
-- RLS defaults to deny, so a couple or guest JWT cannot select the body,
-- including through an embedded resource. Staff use xos_is_staff().

alter table public.planning_sections
  add column if not exists client_notes text;

alter table public.planning_sections
  drop constraint if exists planning_sections_client_notes_len;

alter table public.planning_sections
  add constraint planning_sections_client_notes_len
  check (client_notes is null or char_length(client_notes) <= 4000);

comment on column public.planning_sections.client_notes is
  'Free-text details for this moment. Visible to the couple, guests who can read the section (guest_enabled), and staff. Hosts may update only this column.';

-- Hosts (the couple on the event; xos_is_host also matches staff) may update
-- rows for their event. The trigger below is what keeps that to client_notes.
drop policy if exists "host update client notes" on public.planning_sections;
create policy "host update client notes"
  on public.planning_sections
  for update
  to authenticated
  using ((select public.xos_is_host(event_id)))
  with check ((select public.xos_is_host(event_id)));

create or replace function public.planning_sections_limit_client_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service role and migration roles keep full column access. Triggers still
  -- fire for them; RLS does not.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if current_user = 'authenticated' and (select public.xos_is_staff()) then
    return new;
  end if;
  if (to_jsonb(old) - 'client_notes') is distinct from (to_jsonb(new) - 'client_notes') then
    raise exception 'Only client_notes can be updated for this event'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists planning_sections_limit_client_update on public.planning_sections;
create trigger planning_sections_limit_client_update
  before update on public.planning_sections
  for each row
  execute function public.planning_sections_limit_client_update();

revoke all on function public.planning_sections_limit_client_update() from public, anon;
grant execute on function public.planning_sections_limit_client_update() to authenticated, service_role;

-- ───────────────────────── Staff-only notes ─────────────────────────

create table if not exists public.planning_section_staff_notes (
  section_id uuid primary key references public.planning_sections(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  body       text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint planning_section_staff_notes_body_len
    check (body is null or char_length(body) <= 4000)
);

create index if not exists pssn_event_idx on public.planning_section_staff_notes(event_id);

comment on table public.planning_section_staff_notes is
  'Internal notes for a planning moment. Staff only — no select/insert/update policy for clients or guests.';

create or replace function public.planning_section_staff_notes_bind()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event uuid;
begin
  select s.event_id into v_event
  from public.planning_sections s
  where s.id = new.section_id;
  if v_event is null then
    raise exception 'planning section not found' using errcode = '23503';
  end if;
  if new.event_id is distinct from v_event then
    raise exception 'event_id does not match the planning section' using errcode = '23514';
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists planning_section_staff_notes_bind on public.planning_section_staff_notes;
create trigger planning_section_staff_notes_bind
  before insert or update on public.planning_section_staff_notes
  for each row
  execute function public.planning_section_staff_notes_bind();

revoke all on function public.planning_section_staff_notes_bind() from public, anon;
grant execute on function public.planning_section_staff_notes_bind() to authenticated, service_role;

alter table public.planning_section_staff_notes enable row level security;

revoke all on table public.planning_section_staff_notes from public, anon;
grant select, insert, update on table public.planning_section_staff_notes to authenticated;
grant select, insert, update, delete on table public.planning_section_staff_notes to service_role;

drop policy if exists "staff read section staff notes" on public.planning_section_staff_notes;
create policy "staff read section staff notes"
  on public.planning_section_staff_notes
  for select
  to authenticated
  using ((select public.xos_is_staff()));

drop policy if exists "staff insert section staff notes" on public.planning_section_staff_notes;
create policy "staff insert section staff notes"
  on public.planning_section_staff_notes
  for insert
  to authenticated
  with check ((select public.xos_is_staff()));

drop policy if exists "staff update section staff notes" on public.planning_section_staff_notes;
create policy "staff update section staff notes"
  on public.planning_section_staff_notes
  for update
  to authenticated
  using ((select public.xos_is_staff()))
  with check ((select public.xos_is_staff()));

-- ───────────────────── Do-not-play free text (per event) ─────────────────────
-- Artists, genres, and styles the couple wants avoided ("no reggaeton before
-- 10pm, no Pitbull"). This is not a specific song, so it does not belong on
-- planning_songs. It is also not planning_sections.client_notes: only some
-- templates have a "Don't Play" section (Quince does, the wedding template
-- does not), and that column is the general per-moment Notes field. One row
-- per event keeps the mobile contract event-scoped and always available.
--
-- Hosts edit it the same way they edit songs: xos_is_host (the couple on the
-- event, and staff). Guests have no policy.

create table if not exists public.planning_do_not_play_notes (
  event_id   uuid primary key references public.events(id) on delete cascade,
  body       text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint planning_do_not_play_notes_body_len
    check (body is null or char_length(body) <= 4000)
);

comment on table public.planning_do_not_play_notes is
  'Per-event free text of artists, genres, and styles to avoid. Couple and staff. Not the per-song do-not-play flags.';

create or replace function public.planning_do_not_play_notes_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists planning_do_not_play_notes_touch on public.planning_do_not_play_notes;
create trigger planning_do_not_play_notes_touch
  before insert or update on public.planning_do_not_play_notes
  for each row
  execute function public.planning_do_not_play_notes_touch();

revoke all on function public.planning_do_not_play_notes_touch() from public, anon;
grant execute on function public.planning_do_not_play_notes_touch() to authenticated, service_role;

alter table public.planning_do_not_play_notes enable row level security;

revoke all on table public.planning_do_not_play_notes from public, anon;
grant select, insert, update on table public.planning_do_not_play_notes to authenticated;
grant select, insert, update, delete on table public.planning_do_not_play_notes to service_role;

drop policy if exists "host read do not play notes" on public.planning_do_not_play_notes;
create policy "host read do not play notes"
  on public.planning_do_not_play_notes
  for select
  to authenticated
  using ((select public.xos_is_host(event_id)));

drop policy if exists "host insert do not play notes" on public.planning_do_not_play_notes;
create policy "host insert do not play notes"
  on public.planning_do_not_play_notes
  for insert
  to authenticated
  with check ((select public.xos_is_host(event_id)));

drop policy if exists "host update do not play notes" on public.planning_do_not_play_notes;
create policy "host update do not play notes"
  on public.planning_do_not_play_notes
  for update
  to authenticated
  using ((select public.xos_is_host(event_id)))
  with check ((select public.xos_is_host(event_id)));
