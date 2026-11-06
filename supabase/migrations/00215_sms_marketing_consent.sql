-- App marketing-SMS choices. Append-only so withdrawal history stays.
-- A grant is valid only for the mobile number stored on that row.
-- This is not email consent and it does not replace the STOP list.
-- Do not apply this file from the app. Drew reviews it and applies it.

create table if not exists public.sms_marketing_consent_events (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  phone_e164 text not null,
  action text not null check (action in ('grant', 'withdraw')),
  disclosure_version text not null,
  source text not null check (source in ('app', 'web')),
  created_at timestamptz not null default now()
);

comment on table public.sms_marketing_consent_events is
  'History of marketing text choices. Latest grant for a phone is the current choice. STOP suppression is a separate table.';

create index if not exists sms_marketing_consent_user_idx
  on public.sms_marketing_consent_events (auth_user_id, created_at desc);
create index if not exists sms_marketing_consent_client_idx
  on public.sms_marketing_consent_events (client_id, created_at desc)
  where client_id is not null;

alter table public.sms_marketing_consent_events enable row level security;

revoke all on table public.sms_marketing_consent_events from public, anon;
grant select, insert on table public.sms_marketing_consent_events to authenticated;
grant select, insert, update, delete on table public.sms_marketing_consent_events to service_role;

drop policy if exists "staff read sms marketing consent" on public.sms_marketing_consent_events;
create policy "staff read sms marketing consent"
  on public.sms_marketing_consent_events
  for select
  to authenticated
  using (public.xos_is_staff());

drop policy if exists "own read sms marketing consent" on public.sms_marketing_consent_events;
create policy "own read sms marketing consent"
  on public.sms_marketing_consent_events
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "own insert sms marketing consent" on public.sms_marketing_consent_events;
create policy "own insert sms marketing consent"
  on public.sms_marketing_consent_events
  for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and not public.xos_is_staff()
    and length(btrim(phone_e164)) > 0
  );
