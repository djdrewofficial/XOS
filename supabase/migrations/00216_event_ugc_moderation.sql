-- Event content reports, per-member blocks, and soft-hide for Apple guideline 1.2.
--
-- One app member can see another member's song requests (including the song
-- note), song likes, planning answers, moment notes, the music avoid note,
-- song ideas, the cover photo, the photo booth choice, and an uploaded planner
-- timeline. Community posts are not part of this: 00147 dropped them.
--
-- Removal sets hidden_at / hidden_by. The row stays so staff can still read it.
-- Non-staff DELETE of songs, answers, and song ideas is rejected. A member can
-- still delete their own like (unlike).
--
-- Do not apply this file from the app. Drew reviews it and applies it.

-- ───────────────────────── Soft-hide columns ─────────────────────────

alter table public.planning_songs
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

alter table public.planning_song_likes
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

alter table public.planning_question_answers
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

alter table public.song_ideas
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

alter table public.planning_sections
  add column if not exists client_notes_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists client_notes_hidden_at timestamptz,
  add column if not exists client_notes_hidden_by uuid references auth.users(id) on delete set null;

alter table public.planning_do_not_play_notes
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

alter table public.events
  add column if not exists cover_photo_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists cover_photo_hidden_at timestamptz,
  add column if not exists cover_photo_hidden_by uuid references auth.users(id) on delete set null;

alter table public.event_photobooth_selection
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

alter table public.event_files
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references auth.users(id) on delete set null;

comment on column public.planning_songs.hidden_at is
  'Soft-hide. Staff still see the row. Non-staff do not.';

-- ───────────────────────── Reports and blocks ─────────────────────────

create table if not exists public.event_content_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in (
    'song', 'song_like', 'answer', 'section_note', 'do_not_play_note',
    'song_idea', 'cover_photo', 'booth_selection', 'timeline_file', 'user'
  )),
  target_id uuid,
  target_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('offensive', 'spam', 'harassment', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint event_content_reports_details_len check (details is null or char_length(details) <= 1000),
  -- A live user or song-like report must name the person. That requirement is
  -- enforced on insert. After the reported login is deleted, target_user_id is
  -- cleared and the report row stays, so this check allows that null.
  constraint event_content_reports_target check (
    (target_type = 'user')
    or (target_type = 'song_like' and target_id is not null)
    or (target_type not in ('user', 'song_like') and target_id is not null)
  )
);

create index if not exists event_content_reports_event_idx
  on public.event_content_reports (event_id, status, created_at desc);

create unique index if not exists event_content_reports_one_open
  on public.event_content_reports (
    event_id,
    reporter_id,
    target_type,
    coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'open';

comment on table public.event_content_reports is
  'Member reports of event content or another member. Reporter reads their own. Staff read and resolve. Reported rows stay visible to staff.';

create table if not exists public.event_member_blocks (
  event_id uuid not null references public.events(id) on delete cascade,
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, blocker_id, blocked_id),
  constraint event_member_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists event_member_blocks_blocker_idx
  on public.event_member_blocks (event_id, blocker_id);

comment on table public.event_member_blocks is
  'Hide for me. The blocker does not see the blocked member''s event content. Staff still see it.';

-- ───────────────────────── Who is a host or guest ─────────────────────────
-- Parameterized copies of xos_is_host / xos_guest_of so a trigger can judge
-- the author, not only auth.uid().

create or replace function public.xos_user_is_host(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and (
      exists (
        select 1 from public.accounts a
        where a.auth_user_id = p_user_id and a.account_type = 'staff'
      )
      or exists (
        select 1 from public.accounts a
        where a.auth_user_id = p_user_id
          and a.account_type = 'client'
          and (
            exists (
              select 1 from public.event_clients ec
              where ec.event_id = p_event_id and ec.client_id = a.client_id
            )
            or exists (
              select 1 from public.events e
              where e.id = p_event_id and e.client_id = a.client_id
            )
          )
      )
      or exists (
        select 1 from public.event_app_members m
        where m.event_id = p_event_id
          and m.auth_user_id = p_user_id
          and m.role = 'host'
      )
    );
$$;

create or replace function public.xos_user_is_guest(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and not public.xos_user_is_host(p_event_id, p_user_id)
    and (
      exists (
        select 1 from public.accounts a
        join public.event_guests g on g.id = a.event_guest_id
        where a.auth_user_id = p_user_id
          and a.account_type = 'event_guest'
          and g.event_id = p_event_id
      )
      or exists (
        select 1 from public.event_app_members m
        where m.event_id = p_event_id
          and m.auth_user_id = p_user_id
          and m.role = 'guest'
      )
    );
$$;

-- p_shared: moment notes, avoid text, cover, booth, and the timeline file.
-- Either host may hide those. Songs, likes, answers, and song ideas are not
-- shared: a host may hide a guest's row or their own, not another host's.
create or replace function public.xos_can_hide_ugc(p_event_id uuid, p_author_id uuid, p_shared boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.xos_is_staff() then
    return true;
  end if;
  if p_author_id is not null and p_author_id = auth.uid() then
    return true;
  end if;
  if public.xos_is_host(p_event_id) and p_shared then
    return true;
  end if;
  if public.xos_is_host(p_event_id) and (p_author_id is null or public.xos_user_is_guest(p_event_id, p_author_id)) then
    return true;
  end if;
  return false;
end;
$$;

-- Staff see hidden rows and blocked authors. Everyone else does not.
-- security invoker so the block lookup uses the caller's own block rows.
create or replace function public.xos_ugc_row_visible(p_event_id uuid, p_author_id uuid, p_hidden_at timestamptz)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    public.xos_is_staff()
    or (
      p_hidden_at is null
      and (
        p_author_id is null
        or not exists (
          select 1 from public.event_member_blocks b
          where b.event_id = p_event_id
            and b.blocker_id = auth.uid()
            and b.blocked_id = p_author_id
        )
      )
    );
$$;

revoke all on function public.xos_user_is_host(uuid, uuid) from public, anon;
revoke all on function public.xos_user_is_guest(uuid, uuid) from public, anon;
revoke all on function public.xos_can_hide_ugc(uuid, uuid, boolean) from public, anon;
revoke all on function public.xos_ugc_row_visible(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.xos_user_is_host(uuid, uuid) to authenticated, service_role;
grant execute on function public.xos_user_is_guest(uuid, uuid) to authenticated, service_role;
grant execute on function public.xos_can_hide_ugc(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.xos_ugc_row_visible(uuid, uuid, timestamptz) to authenticated, service_role;

-- ───────────────────────── Hide and delete guards ─────────────────────────

-- True when a nested update only clears user foreign keys to null.
-- Parent account deletion uses this. A direct edit that points a column at
-- someone else does not.
create or replace function public.xos_fk_user_clear(old_row jsonb, new_row jsonb)
returns boolean
language sql
immutable
as $$
  select
    (old_row - array[
      'hidden_by', 'uploaded_by', 'updated_by', 'requested_by', 'answered_by', 'added_by',
      'account_id', 'client_notes_updated_by', 'client_notes_hidden_by',
      'cover_photo_updated_by', 'cover_photo_hidden_by', 'target_user_id', 'resolved_by'
    ]) is not distinct from
    (new_row - array[
      'hidden_by', 'uploaded_by', 'updated_by', 'requested_by', 'answered_by', 'added_by',
      'account_id', 'client_notes_updated_by', 'client_notes_hidden_by',
      'cover_photo_updated_by', 'cover_photo_hidden_by', 'target_user_id', 'resolved_by'
    ])
    and not exists (
      select 1
      from jsonb_object_keys(old_row) as key
      where key = any (array[
        'hidden_by', 'uploaded_by', 'updated_by', 'requested_by', 'answered_by', 'added_by',
        'account_id', 'client_notes_updated_by', 'client_notes_hidden_by',
        'cover_photo_updated_by', 'cover_photo_hidden_by', 'target_user_id', 'resolved_by'
      ])
        and (old_row -> key) is distinct from (new_row -> key)
        and (new_row -> key) is distinct from 'null'::jsonb
    );
$$;

revoke all on function public.xos_fk_user_clear(jsonb, jsonb) from public, anon;
grant execute on function public.xos_fk_user_clear(jsonb, jsonb) to authenticated, service_role;

create or replace function public.ugc_guard_hide()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  author_id uuid;
  event_id uuid;
  shared boolean := false;
begin
  if pg_trigger_depth() > 1 and public.xos_fk_user_clear(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if tg_table_name = 'planning_songs' then
    author_id := old.requested_by;
    event_id := old.event_id;
    shared := false;
  elsif tg_table_name = 'planning_song_likes' then
    author_id := old.account_id;
    select s.event_id into event_id from public.planning_songs s where s.id = old.song_id;
    shared := false;
  elsif tg_table_name = 'planning_question_answers' then
    author_id := old.answered_by;
    event_id := old.event_id;
    shared := false;
  elsif tg_table_name = 'song_ideas' then
    author_id := old.added_by;
    event_id := old.event_id;
    shared := false;
  elsif tg_table_name = 'planning_do_not_play_notes' then
    author_id := old.updated_by;
    event_id := old.event_id;
    shared := true;
  elsif tg_table_name = 'event_photobooth_selection' then
    author_id := old.updated_by;
    event_id := old.event_id;
    shared := true;
  elsif tg_table_name = 'event_files' then
    author_id := old.uploaded_by;
    event_id := old.event_id;
    shared := true;
  else
    return new;
  end if;

  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if old.hidden_at is not null and not public.xos_is_staff() then
    if tg_table_name = 'planning_song_likes'
       and author_id = auth.uid()
       and new.hidden_at is null then
      new.hidden_by := null;
      return new;
    end if;
    raise exception 'This was removed' using errcode = '42501';
  end if;

  if new.hidden_at is not distinct from old.hidden_at
     and new.hidden_by is not distinct from old.hidden_by then
    return new;
  end if;

  if new.hidden_at is null and old.hidden_at is not null then
    if not public.xos_is_staff() then
      raise exception 'Only staff can restore removed content' using errcode = '42501';
    end if;
    return new;
  end if;

  if not public.xos_can_hide_ugc(event_id, author_id, shared) then
    raise exception 'You can only remove your own content' using errcode = '42501';
  end if;

  if not public.xos_is_staff() then
    new.hidden_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.ugc_block_hard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return old;
  end if;
  if public.xos_is_staff() then
    return old;
  end if;
  if tg_table_name = 'planning_song_likes' then
    if old.account_id = auth.uid() then
      return old;
    end if;
  elsif tg_table_name = 'event_files' then
    if old.source is distinct from 'planner_timeline' then
      return old;
    end if;
  end if;
  raise exception 'Remove content by hiding it so the DJ can still see it'
    using errcode = '42501';
end;
$$;

revoke all on function public.ugc_guard_hide() from public, anon;
revoke all on function public.ugc_block_hard_delete() from public, anon;
grant execute on function public.ugc_guard_hide() to authenticated, service_role;
grant execute on function public.ugc_block_hard_delete() to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'planning_songs',
    'planning_song_likes',
    'planning_question_answers',
    'song_ideas',
    'planning_do_not_play_notes',
    'event_photobooth_selection',
    'event_files'
  ]
  loop
    execute format('drop trigger if exists ugc_guard_hide on public.%I', t);
    execute format(
      'create trigger ugc_guard_hide before update on public.%I for each row execute function public.ugc_guard_hide()',
      t
    );
    execute format('drop trigger if exists ugc_block_hard_delete on public.%I', t);
    execute format(
      'create trigger ugc_block_hard_delete before delete on public.%I for each row execute function public.ugc_block_hard_delete()',
      t
    );
  end loop;
end $$;

-- Moment notes stay on the section row. Only client_notes is a free edit.
-- Hide columns are a second allowed change, and only when xos_can_hide_ugc says so.
create or replace function public.planning_sections_limit_client_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 and public.xos_fk_user_clear(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if current_user in ('service_role', 'postgres', 'supabase_admin') or public.xos_is_staff() then
    if new.client_notes is distinct from old.client_notes then
      if auth.uid() is not null then
        new.client_notes_updated_by := auth.uid();
      end if;
      new.client_notes_hidden_at := null;
      new.client_notes_hidden_by := null;
    end if;
    return new;
  end if;

  if old.client_notes_hidden_at is not null then
    raise exception 'This was removed' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.event_id is distinct from old.event_id
     or new.title is distinct from old.title
     or new.sort_order is distinct from old.sort_order
     or new.guest_enabled is distinct from old.guest_enabled
     or new.client_editable is distinct from old.client_editable
     or new.locked is distinct from old.locked
     or new.deleted_by_host is distinct from old.deleted_by_host
     or new.deleted_by_host_at is distinct from old.deleted_by_host_at
  then
    raise exception 'Only client_notes can be updated for this event'
      using errcode = '42501';
  end if;

  if new.client_notes is distinct from old.client_notes then
    new.client_notes_updated_by := auth.uid();
    new.client_notes_hidden_at := null;
    new.client_notes_hidden_by := null;
  else
    new.client_notes_updated_by := old.client_notes_updated_by;
    if new.client_notes_hidden_at is distinct from old.client_notes_hidden_at
       or new.client_notes_hidden_by is distinct from old.client_notes_hidden_by then
      if new.client_notes_hidden_at is null then
        raise exception 'Only staff can restore removed content' using errcode = '42501';
      end if;
      if not public.xos_can_hide_ugc(old.event_id, old.client_notes_updated_by, true) then
        raise exception 'You can only remove your own content' using errcode = '42501';
      end if;
      new.client_notes_hidden_by := auth.uid();
    end if;
  end if;

  if (to_jsonb(old) - 'client_notes' - 'client_notes_updated_by' - 'client_notes_hidden_at' - 'client_notes_hidden_by')
     is distinct from
     (to_jsonb(new) - 'client_notes' - 'client_notes_updated_by' - 'client_notes_hidden_at' - 'client_notes_hidden_by')
  then
    raise exception 'Only client_notes can be updated for this event'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.events_guard_cover_hide()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 and public.xos_fk_user_clear(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if new.cover_photo_url is not distinct from old.cover_photo_url
     and new.cover_photo_updated_by is not distinct from old.cover_photo_updated_by
     and new.cover_photo_hidden_at is not distinct from old.cover_photo_hidden_at
     and new.cover_photo_hidden_by is not distinct from old.cover_photo_hidden_by
  then
    return new;
  end if;
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if old.cover_photo_hidden_at is not null and not public.xos_is_staff() then
    raise exception 'This was removed' using errcode = '42501';
  end if;
  if new.cover_photo_url is distinct from old.cover_photo_url then
    if auth.uid() is not null then
      new.cover_photo_updated_by := auth.uid();
    end if;
    new.cover_photo_hidden_at := null;
    new.cover_photo_hidden_by := null;
  end if;
  if new.cover_photo_hidden_at is distinct from old.cover_photo_hidden_at
     or new.cover_photo_hidden_by is distinct from old.cover_photo_hidden_by then
    if new.cover_photo_hidden_at is null and old.cover_photo_hidden_at is not null and not public.xos_is_staff() then
      raise exception 'Only staff can restore removed content' using errcode = '42501';
    end if;
    if new.cover_photo_hidden_at is not null
       and not public.xos_can_hide_ugc(old.id, old.cover_photo_updated_by, true) then
      raise exception 'You can only remove your own content' using errcode = '42501';
    end if;
    if new.cover_photo_hidden_at is not null and not public.xos_is_staff() then
      new.cover_photo_hidden_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.events_guard_cover_hide() from public, anon;
grant execute on function public.events_guard_cover_hide() to authenticated, service_role;

drop trigger if exists events_guard_cover_hide on public.events;
create trigger events_guard_cover_hide
  before update on public.events
  for each row
  execute function public.events_guard_cover_hide();

-- 00213 rejects a guest change to requested_by. Account deletion clears that
-- column through the foreign key, with no signed-in user. Keep the guest lock
-- for a direct edit.
create or replace function public.planning_songs_limit_guest_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 and public.xos_fk_user_clear(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if public.xos_is_host(old.event_id) then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.event_id is distinct from old.event_id
     or new.section_id is distinct from old.section_id
     or new.requested_by is distinct from old.requested_by
  then
    raise exception 'Guests cannot move a song to another event or section'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists planning_songs_limit_guest_update on public.planning_songs;
create trigger planning_songs_limit_guest_update
  before update on public.planning_songs
  for each row
  execute function public.planning_songs_limit_guest_update();

drop trigger if exists planning_sections_limit_client_update on public.planning_sections;
create trigger planning_sections_limit_client_update
  before update on public.planning_sections
  for each row
  execute function public.planning_sections_limit_client_update();

revoke all on function public.planning_songs_limit_guest_update() from public, anon;
grant execute on function public.planning_songs_limit_guest_update() to authenticated, service_role;

-- ───────────────────────── RLS: hidden and blocked rows ─────────────────────────

drop policy if exists "ugc hide songs" on public.planning_songs;
create policy "ugc hide songs" on public.planning_songs
  as restrictive for select to authenticated
  using (public.xos_ugc_row_visible(event_id, requested_by, hidden_at));

drop policy if exists "ugc hide song likes" on public.planning_song_likes;
create policy "ugc hide song likes" on public.planning_song_likes
  as restrictive for select to authenticated
  using (
    public.xos_is_staff()
    or exists (
      select 1 from public.planning_songs s
      where s.id = planning_song_likes.song_id
        and public.xos_ugc_row_visible(s.event_id, planning_song_likes.account_id, planning_song_likes.hidden_at)
        and public.xos_ugc_row_visible(s.event_id, s.requested_by, s.hidden_at)
    )
  );

drop policy if exists "ugc hide answers" on public.planning_question_answers;
create policy "ugc hide answers" on public.planning_question_answers
  as restrictive for select to authenticated
  using (public.xos_ugc_row_visible(event_id, answered_by, hidden_at));

drop policy if exists "ugc hide song ideas" on public.song_ideas;
create policy "ugc hide song ideas" on public.song_ideas
  as restrictive for select to authenticated
  using (public.xos_ugc_row_visible(event_id, added_by, hidden_at));

drop policy if exists "ugc hide do not play notes" on public.planning_do_not_play_notes;
create policy "ugc hide do not play notes" on public.planning_do_not_play_notes
  as restrictive for select to authenticated
  using (public.xos_ugc_row_visible(event_id, updated_by, hidden_at));

drop policy if exists "ugc hide booth selection" on public.event_photobooth_selection;
create policy "ugc hide booth selection" on public.event_photobooth_selection
  as restrictive for select to authenticated
  using (public.xos_ugc_row_visible(event_id, updated_by, hidden_at));

drop policy if exists "ugc hide event files" on public.event_files;
create policy "ugc hide event files" on public.event_files
  as restrictive for select to authenticated
  using (public.xos_ugc_row_visible(event_id, uploaded_by, hidden_at));

-- ───────────────────────── Report and block policies ─────────────────────────

alter table public.event_content_reports enable row level security;
alter table public.event_member_blocks enable row level security;

revoke all on table public.event_content_reports from public, anon;
revoke all on table public.event_member_blocks from public, anon;
grant select, insert, update on table public.event_content_reports to authenticated;
grant select, insert, delete on table public.event_member_blocks to authenticated;
grant select, insert, update, delete on table public.event_content_reports to service_role;
grant select, insert, update, delete on table public.event_member_blocks to service_role;

drop policy if exists "reporter inserts own report" on public.event_content_reports;
create policy "reporter inserts own report" on public.event_content_reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and (public.xos_is_host(event_id) or public.xos_guest_of(event_id))
    and (target_type <> 'user' or target_user_id is distinct from auth.uid())
  );

drop policy if exists "reporter reads own reports" on public.event_content_reports;
create policy "reporter reads own reports" on public.event_content_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.xos_is_staff());

drop policy if exists "staff resolve reports" on public.event_content_reports;
create policy "staff resolve reports" on public.event_content_reports
  for update to authenticated
  using (public.xos_is_staff())
  with check (public.xos_is_staff());

drop policy if exists "member inserts own block" on public.event_member_blocks;
create policy "member inserts own block" on public.event_member_blocks
  for insert to authenticated
  with check (
    blocker_id = auth.uid()
    and blocker_id <> blocked_id
    and (public.xos_is_host(event_id) or public.xos_guest_of(event_id))
    and (
      public.xos_user_is_guest(event_id, blocked_id)
      or (
        public.xos_user_is_host(event_id, blocked_id)
        and not exists (
          select 1 from public.accounts a
          where a.auth_user_id = blocked_id and a.account_type = 'staff'
        )
      )
    )
  );

drop policy if exists "member reads own blocks" on public.event_member_blocks;
create policy "member reads own blocks" on public.event_member_blocks
  for select to authenticated
  using (blocker_id = auth.uid() or public.xos_is_staff());

drop policy if exists "member deletes own block" on public.event_member_blocks;
create policy "member deletes own block" on public.event_member_blocks
  for delete to authenticated
  using (blocker_id = auth.uid());

-- Report and block identity is frozen after insert. A signed-in member cannot
-- file as someone else, and staff resolution cannot move the report to another
-- person, event, or target. created_at is the server clock.
create or replace function public.event_content_reports_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Reported-user and resolver deletion clear only those foreign keys.
    -- Reason, details, target type, song id, reporter, and status stay.
    if pg_trigger_depth() > 1
       and new.id is not distinct from old.id
       and new.event_id is not distinct from old.event_id
       and new.reporter_id is not distinct from old.reporter_id
       and new.target_type is not distinct from old.target_type
       and new.target_id is not distinct from old.target_id
       and new.reason is not distinct from old.reason
       and new.details is not distinct from old.details
       and new.created_at is not distinct from old.created_at
       and new.status is not distinct from old.status
       and new.resolved_at is not distinct from old.resolved_at
       and (new.target_user_id is not distinct from old.target_user_id or new.target_user_id is null)
       and (new.resolved_by is not distinct from old.resolved_by or new.resolved_by is null)
       and (
         new.target_user_id is distinct from old.target_user_id
         or new.resolved_by is distinct from old.resolved_by
       )
    then
      return new;
    end if;
    if new.id is distinct from old.id
       or new.event_id is distinct from old.event_id
       or new.reporter_id is distinct from old.reporter_id
       or new.target_type is distinct from old.target_type
       or new.target_id is distinct from old.target_id
       or new.target_user_id is distinct from old.target_user_id
       or new.reason is distinct from old.reason
       or new.details is distinct from old.details
       or new.created_at is distinct from old.created_at
    then
      raise exception 'Report identity cannot be changed' using errcode = '42501';
    end if;
    if new.status = 'open' then
      new.resolved_by := null;
      new.resolved_at := null;
    elsif auth.uid() is null or not public.xos_is_staff() then
      raise exception 'Only staff can resolve a report' using errcode = '42501';
    else
      new.resolved_by := auth.uid();
      new.resolved_at := now();
    end if;
    return new;
  end if;
  if auth.uid() is null or new.reporter_id is distinct from auth.uid() then
    raise exception 'Report reporter must be the signed-in member' using errcode = '42501';
  end if;
  if new.target_type = 'user' and new.target_user_id is null then
    raise exception 'Report target is required' using errcode = '23514';
  end if;
  if new.target_type = 'song_like' and (new.target_id is null or new.target_user_id is null) then
    raise exception 'Report target is required' using errcode = '23514';
  end if;
  if new.target_type not in ('user', 'song_like') and new.target_id is null then
    raise exception 'Report target is required' using errcode = '23514';
  end if;
  if not (
    public.xos_user_is_host(new.event_id, new.reporter_id)
    or public.xos_user_is_guest(new.event_id, new.reporter_id)
  ) then
    raise exception 'Report reporter is not on that event' using errcode = '42501';
  end if;
  new.created_at := now();
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  return new;
end;
$$;

create or replace function public.event_member_blocks_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Event, blocker, and blocked-user deletion cascade this row.
    -- A direct delete still has to be the member who blocked.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if auth.uid() is null or old.blocker_id is distinct from auth.uid() then
      raise exception 'Block can only be removed by the member who created it' using errcode = '42501';
    end if;
    return old;
  end if;
  if auth.uid() is null or new.blocker_id is distinct from auth.uid() then
    raise exception 'Block must be filed by the signed-in member' using errcode = '42501';
  end if;
  if not (
    public.xos_user_is_host(new.event_id, new.blocker_id)
    or public.xos_user_is_guest(new.event_id, new.blocker_id)
  ) then
    raise exception 'Blocker is not on that event' using errcode = '42501';
  end if;
  if not (
    public.xos_user_is_host(new.event_id, new.blocked_id)
    or public.xos_user_is_guest(new.event_id, new.blocked_id)
  ) then
    raise exception 'Blocked member is not on that event' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists event_content_reports_enforce on public.event_content_reports;
create trigger event_content_reports_enforce
  before insert or update on public.event_content_reports
  for each row execute function public.event_content_reports_enforce();

drop trigger if exists event_member_blocks_enforce on public.event_member_blocks;
create trigger event_member_blocks_enforce
  before insert or delete on public.event_member_blocks
  for each row execute function public.event_member_blocks_enforce();

revoke all on function public.event_content_reports_enforce() from public, anon, authenticated, service_role;
revoke all on function public.event_member_blocks_enforce() from public, anon, authenticated, service_role;

-- Guests cannot delete someone else's membership. Authenticated has no delete
-- grant on event_app_members (00213 grants select only). Host removal goes
-- through the service role after the app checks the target is a guest.

-- ───────────────────────── Staff bell ─────────────────────────
-- Same catalog the in-app bell already reads. In-app on for admins and the
-- event salesperson. The event page also badges open reports.

insert into public.notification_types (
  key, label, category, description, staff_title_tpl, staff_body_tpl, href_tpl, sort_order
) values (
  'content_report',
  'Content report',
  'events',
  'A couple or guest reported event content or a person.',
  'Content reported',
  'A member reported content on <event_name>.',
  '/events/<event_id>?tab=notes',
  16
) on conflict (key) do nothing;

insert into public.notification_settings (type_key, audience, is_enabled, in_app, push, email, sms) values
  ('content_report', 'master_admin', true, true, true, false, false),
  ('content_report', 'admin', true, true, true, false, false),
  ('content_report', 'event_salesperson', true, true, true, false, false)
on conflict (type_key, audience) do nothing;
