-- Per person, per event opt-in before staff tools send that event's personal
-- data to OpenAI. Default is no row, which means no consent.
-- Do not apply this file from the app. Drew reviews it and applies it.

create table if not exists public.ai_consents (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  event_guest_id uuid references public.event_guests(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  policy_version text not null,
  source text not null check (source in ('app', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, event_id)
);

comment on table public.ai_consents is
  'Explicit opt-in for staff AI tools to use this person''s event data. No row means not granted.';

create index if not exists ai_consents_event_idx on public.ai_consents (event_id);
create index if not exists ai_consents_client_idx on public.ai_consents (client_id) where client_id is not null;

alter table public.ai_consents enable row level security;

revoke all on table public.ai_consents from public, anon;
grant select, insert, update on table public.ai_consents to authenticated;
grant select, insert, update, delete on table public.ai_consents to service_role;

drop policy if exists "staff read ai consents" on public.ai_consents;
create policy "staff read ai consents"
  on public.ai_consents
  for select
  to authenticated
  using (public.xos_is_staff());

drop policy if exists "own read ai consents" on public.ai_consents;
create policy "own read ai consents"
  on public.ai_consents
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "own insert ai consents" on public.ai_consents;
create policy "own insert ai consents"
  on public.ai_consents
  for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and not public.xos_is_staff()
    and (
      exists (
        select 1 from public.accounts a
        where a.auth_user_id = auth.uid()
          and a.account_type = 'client'
          and a.client_id = ai_consents.client_id
          and (
            exists (
              select 1 from public.event_clients ec
              where ec.event_id = ai_consents.event_id and ec.client_id = a.client_id
            )
            or exists (
              select 1 from public.events e
              where e.id = ai_consents.event_id and e.client_id = a.client_id
            )
          )
      )
      or exists (
        select 1 from public.accounts a
        where a.auth_user_id = auth.uid()
          and a.account_type = 'event_guest'
          and a.event_guest_id = ai_consents.event_guest_id
          and exists (
            select 1 from public.event_guests g
            where g.id = a.event_guest_id and g.event_id = ai_consents.event_id
          )
      )
      or exists (
        select 1 from public.event_app_members m
        where m.event_id = ai_consents.event_id
          and m.auth_user_id = auth.uid()
      )
    )
  );

drop policy if exists "own update ai consents" on public.ai_consents;
create policy "own update ai consents"
  on public.ai_consents
  for update
  to authenticated
  using (auth_user_id = auth.uid() and not public.xos_is_staff())
  with check (auth_user_id = auth.uid() and not public.xos_is_staff());
