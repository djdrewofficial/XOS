-- Host and guest join links for the couple app.
--
-- Each event has one host link and one guest link. The token lives in the URL
-- path (/j/<token>), never a query string, so iOS Link Tracking Protection
-- does not strip it. Only a hash is stored for lookup. The ciphertext lets
-- staff show the link again. The key is the same one as join codes
-- (EVENT_JOIN_CODE_KEY, or the service role key).
--
-- Redeeming a link writes event_app_members. A host link also links a client
-- account onto the event when that login can be a client. A guest link does
-- not. Host keeps full access. Guest can read and fill out only the planning
-- sections with guest_enabled. Payments, agreements, and the private event
-- row stay with hosts and staff.
--
-- Do not apply this file from the app. Drew reviews it and applies it.

-- ───────────────────────── Membership ─────────────────────────

create table if not exists public.event_app_members (
  event_id uuid not null references public.events(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  created_at timestamptz not null default now(),
  primary key (event_id, auth_user_id)
);

create index if not exists event_app_members_user_idx
  on public.event_app_members (auth_user_id);

comment on table public.event_app_members is
  'Per-event app role from a join link or join code. Host is full access. Guest is open sections only.';

-- ───────────────────────── Links ─────────────────────────

create table if not exists public.event_join_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  token_hash text not null unique,
  token_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reset_at timestamptz,
  reset_by uuid references auth.users(id) on delete set null,
  unique (event_id, role)
);

comment on table public.event_join_links is
  'Per-event host and guest join links. Hash for lookup, ciphertext for display. No plaintext token column.';

alter table public.event_join_attempts
  add column if not exists attempt_kind text not null default 'code';

alter table public.event_join_attempts
  drop constraint if exists event_join_attempts_kind_check;

alter table public.event_join_attempts
  add constraint event_join_attempts_kind_check
  check (attempt_kind in ('code', 'link'));

-- ───────────────────────── Host / guest checks ─────────────────────────
-- xos_is_host still includes staff and a client listed on the event.
-- A host membership row counts too, so a login that cannot also be a client
-- (an older guest account) can still be a host of this event.
-- xos_guest_of is a guest membership or a legacy event_guest row, and never
-- someone who is already a host of the same event.

create or replace function public.xos_is_host(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.xos_is_staff()
    or exists (
      select 1 from public.accounts a
      where a.auth_user_id = auth.uid()
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
        and m.auth_user_id = auth.uid()
        and m.role = 'host'
    );
$$;

create or replace function public.xos_guest_of(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not public.xos_is_staff()
    and not exists (
      select 1 from public.accounts a
      where a.auth_user_id = auth.uid()
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
    and not exists (
      select 1 from public.event_app_members m
      where m.event_id = p_event_id
        and m.auth_user_id = auth.uid()
        and m.role = 'host'
    )
    and (
      exists (
        select 1 from public.accounts a
        join public.event_guests g on g.id = a.event_guest_id
        where a.auth_user_id = auth.uid()
          and a.account_type = 'event_guest'
          and g.event_id = p_event_id
      )
      or exists (
        select 1 from public.event_app_members m
        where m.event_id = p_event_id
          and m.auth_user_id = auth.uid()
          and m.role = 'guest'
      )
    );
$$;

-- ───────────────────────── RLS ─────────────────────────

alter table public.event_app_members enable row level security;
alter table public.event_join_links enable row level security;

drop policy if exists "read own app membership" on public.event_app_members;
create policy "read own app membership" on public.event_app_members
  for select to authenticated
  using (auth_user_id = auth.uid() or public.xos_is_staff());

revoke all on table public.event_app_members from public, anon;
grant select on table public.event_app_members to authenticated;

revoke all on table public.event_join_links from public, anon, authenticated;

-- ───────────────────────── Guest sections ─────────────────────────
-- Guests already read guest_enabled sections and answer those questions.
-- They can also add songs and edit the moment notes on those sections.
-- They cannot change another person's song, and they cannot see closed sections.

drop policy if exists "guest update client notes on open sections" on public.planning_sections;
create policy "guest update client notes on open sections" on public.planning_sections
  for update to authenticated
  using (public.xos_guest_of(event_id) and guest_enabled)
  with check (public.xos_guest_of(event_id) and guest_enabled);

-- The guest UPDATE policy is permissive and does not name columns. Authenticated
-- has table-level UPDATE, so a guest JWT would otherwise be able to change
-- title, sort_order, guest_enabled, event_id, and every other column. The
-- trigger is the column lock. It already exists for hosts (00207). Replacing
-- it here keeps the same rule for guests: only client_notes. Staff and the
-- service role still update every column.
create or replace function public.planning_sections_limit_client_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if public.xos_is_staff() then
    return new;
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
     or (to_jsonb(old) - 'client_notes') is distinct from (to_jsonb(new) - 'client_notes')
  then
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

drop policy if exists "guest read songs on open sections" on public.planning_songs;
create policy "guest read songs on open sections" on public.planning_songs
  for select to authenticated
  using (
    public.xos_guest_of(event_id)
    and exists (
      select 1 from public.planning_sections s
      where s.id = section_id and s.event_id = planning_songs.event_id and s.guest_enabled
    )
  );

drop policy if exists "guest add songs on open sections" on public.planning_songs;
create policy "guest add songs on open sections" on public.planning_songs
  for insert to authenticated
  with check (
    public.xos_guest_of(event_id)
    and requested_by = auth.uid()
    and exists (
      select 1 from public.planning_sections s
      where s.id = section_id and s.event_id = planning_songs.event_id and s.guest_enabled
    )
  );

drop policy if exists "guest update own songs on open sections" on public.planning_songs;
create policy "guest update own songs on open sections" on public.planning_songs
  for update to authenticated
  using (
    public.xos_guest_of(event_id)
    and requested_by = auth.uid()
    and exists (
      select 1 from public.planning_sections s
      where s.id = section_id and s.event_id = planning_songs.event_id and s.guest_enabled
    )
  )
  with check (
    public.xos_guest_of(event_id)
    and requested_by = auth.uid()
    and exists (
      select 1 from public.planning_sections s
      where s.id = section_id and s.event_id = planning_songs.event_id and s.guest_enabled
    )
  );

drop policy if exists "guest delete own songs on open sections" on public.planning_songs;
create policy "guest delete own songs on open sections" on public.planning_songs
  for delete to authenticated
  using (
    public.xos_guest_of(event_id)
    and requested_by = auth.uid()
    and exists (
      select 1 from public.planning_sections s
      where s.id = section_id and s.event_id = planning_songs.event_id and s.guest_enabled
    )
  );

-- SELECT of every like on an open section (the count). Writes only the
-- caller's own like. A single FOR ALL policy would let a guest delete or
-- retarget someone else's like, because DELETE checks USING only.
drop policy if exists "guest song likes on open sections" on public.planning_song_likes;
drop policy if exists "guest read song likes on open sections" on public.planning_song_likes;
create policy "guest read song likes on open sections" on public.planning_song_likes
  for select to authenticated
  using (
    exists (
      select 1 from public.planning_songs song
      join public.planning_sections s on s.id = song.section_id
      where song.id = song_id
        and s.guest_enabled
        and public.xos_guest_of(song.event_id)
    )
  );

drop policy if exists "guest write own song likes" on public.planning_song_likes;
create policy "guest write own song likes" on public.planning_song_likes
  for all to authenticated
  using (
    account_id = auth.uid()
    and exists (
      select 1 from public.planning_songs song
      join public.planning_sections s on s.id = song.section_id
      where song.id = song_id
        and s.guest_enabled
        and public.xos_guest_of(song.event_id)
    )
  )
  with check (
    account_id = auth.uid()
    and exists (
      select 1 from public.planning_songs song
      join public.planning_sections s on s.id = song.section_id
      where song.id = song_id
        and s.guest_enabled
        and public.xos_guest_of(song.event_id)
    )
  );

-- A guest who is also a guest of another event could otherwise change
-- event_id or section_id and move their song across events. Hosts and staff
-- are unchanged.
create or replace function public.planning_songs_limit_guest_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
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

revoke all on function public.planning_songs_limit_guest_update() from public, anon;
grant execute on function public.planning_songs_limit_guest_update() to authenticated, service_role;

-- ───────────────────────── Hide money and private event rows ─────────────────────────
-- Guests used to pass xos_can_access_event, which let them select payments,
-- the schedule, add-on prices, the full events row (including pay tokens and
-- prices), couple contacts, and files in the event-files bucket.
--
-- "hide venue-paid financials" (00199) is RESTRICTIVE, so it is ANDed with the
-- permissive read policy. It does not grant rows by itself. Its expression is
-- still "staff OR NOT hidden". If that policy were ever recreated as the
-- default PERMISSIVE kind, the OR would let every authenticated user, including
-- a guest or a stranger, read money on any event that is not venue-hidden.
-- Recreate it as RESTRICTIVE and require a host (staff still see hidden events).

drop policy if exists "read own event payments" on public.payments;
create policy "read own event payments" on public.payments
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "hide venue-paid financials" on public.payments;
create policy "hide venue-paid financials" on public.payments
  as restrictive for select to authenticated
  using (
    public.xos_is_staff()
    or (public.xos_is_host(event_id) and not public.event_financials_hidden(event_id))
  );

drop policy if exists "read own event scheduled payments" on public.scheduled_payments;
create policy "read own event scheduled payments" on public.scheduled_payments
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "hide venue-paid financials" on public.scheduled_payments;
create policy "hide venue-paid financials" on public.scheduled_payments
  as restrictive for select to authenticated
  using (
    public.xos_is_staff()
    or (public.xos_is_host(event_id) and not public.event_financials_hidden(event_id))
  );

drop policy if exists "read own event addons" on public.event_addons;
create policy "read own event addons" on public.event_addons
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "hide venue-paid financials" on public.event_addons;
create policy "hide venue-paid financials" on public.event_addons
  as restrictive for select to authenticated
  using (
    public.xos_is_staff()
    or (public.xos_is_host(event_id) and not public.event_financials_hidden(event_id))
  );

drop policy if exists "read own events" on public.events;
create policy "read own events" on public.events
  for select to authenticated
  using (public.xos_is_host(id));

drop policy if exists "read own event clients" on public.event_clients;
create policy "read own event clients" on public.event_clients
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "read own event guests" on public.event_guests;
create policy "read own event guests" on public.event_guests
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "event access event vendors" on public.event_vendors;
create policy "event access event vendors" on public.event_vendors
  for all to authenticated
  using (public.xos_is_host(event_id))
  with check (public.xos_is_host(event_id));

drop policy if exists "event-files read scoped" on storage.objects;
create policy "event-files read scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-files'
    and (
      public.xos_is_staff()
      or (
        (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        and public.xos_is_host(((storage.foldername(name))[1])::uuid)
      )
    )
  );

-- Safe columns for a guest. security_invoker off so the view can read venues
-- and event types (guests can no longer select events). security_barrier stops
-- a caller's WHERE function from seeing rows xos_guest_of already rejected.
-- Prices, pay tokens, notes, and client ids are not in the list. The filter
-- is per event id, so a guest of event A does not see event B.
create or replace view public.event_guest_card
  with (security_invoker = off, security_barrier = true) as
  select
    e.id,
    e.name,
    e.event_date,
    e.start_time,
    e.end_time,
    e.guest_count,
    e.cover_photo_url,
    e.event_type_id,
    et.name as event_type,
    v.name as venue_name
  from public.events e
  left join public.event_types et on et.id = e.event_type_id
  left join public.venues v on v.id = e.venue_id
  where public.xos_guest_of(e.id);

comment on view public.event_guest_card is
  'Event name, date, and venue for a guest. No prices, pay links, or private notes.';

revoke all on public.event_guest_card from public, anon;
grant select on public.event_guest_card to authenticated;

-- Helpers stay executable by authenticated (RLS calls them). They are not
-- granted to anon. Replacing the functions above does not by itself change
-- grants; say so here so a later edit does not open them to anon.
revoke all on function public.xos_is_host(uuid) from public, anon;
grant execute on function public.xos_is_host(uuid) to authenticated, service_role;
revoke all on function public.xos_guest_of(uuid) from public, anon;
grant execute on function public.xos_guest_of(uuid) to authenticated, service_role;

-- ───────────────────────── Merge tags ─────────────────────────
-- Filled in TypeScript at send time (the token is sealed in the app). Listing
-- them here keeps render_merge_tags from stripping the tags first.

insert into public.merge_tags (tag_key, label, group_name, description, is_builtin, source_type, is_active, sort_order)
values
  (
    'app_host_link',
    'App host link',
    'Account',
    'Link that joins this event as a host (the couple or a planner). Filled when the email is sent. Sent as the real URL, without click tracking.',
    true,
    'builtin',
    true,
    3
  ),
  (
    'app_guest_link',
    'App guest link',
    'Account',
    'Link that joins this event as a guest. Guests only see the sections opened to them. Filled when the email is sent.',
    true,
    'builtin',
    true,
    4
  )
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      is_builtin = true,
      source_type = 'builtin',
      is_active = true;

update public.email_templates
set body_html = body_html || '<p><a href="<app_host_link>">Open your event in the app</a></p>'
where name = 'Client Invite / Set Password'
  and coalesce(body_html, '') not like '%app_host_link%';
