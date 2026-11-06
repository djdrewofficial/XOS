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

drop policy if exists "guest song likes on open sections" on public.planning_song_likes;
create policy "guest song likes on open sections" on public.planning_song_likes
  for all to authenticated
  using (
    exists (
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

-- ───────────────────────── Hide money and private event rows ─────────────────────────
-- Guests used to pass xos_can_access_event, which let them select payments,
-- the schedule, add-on prices, the full events row (including pay tokens and
-- prices), couple contacts, and files in the event-files bucket.

drop policy if exists "read own event payments" on public.payments;
create policy "read own event payments" on public.payments
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "read own event scheduled payments" on public.scheduled_payments;
create policy "read own event scheduled payments" on public.scheduled_payments
  for select to authenticated
  using (public.xos_is_host(event_id));

drop policy if exists "read own event addons" on public.event_addons;
create policy "read own event addons" on public.event_addons
  for select to authenticated
  using (public.xos_is_host(event_id));

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
-- and event types, then keep only this event's guest. Prices, pay tokens,
-- notes, and client ids are not in the list.
create or replace view public.event_guest_card
  with (security_invoker = off) as
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
