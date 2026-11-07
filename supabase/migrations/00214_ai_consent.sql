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

revoke all on table public.ai_consents from public, anon, authenticated;
grant select on table public.ai_consents to authenticated;
grant select on table public.ai_consents to service_role;

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
drop policy if exists "own update ai consents" on public.ai_consents;

-- Authenticated has SELECT only. The mobile route writes with the service
-- role after it checks the contract client. This trigger still runs for the
-- service role, so a forged client, event, guest, or timestamp is rejected.

create or replace function public.ai_consents_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.auth_user_id is distinct from old.auth_user_id
       or new.client_id is distinct from old.client_id
       or new.event_guest_id is distinct from old.event_guest_id
       or new.event_id is distinct from old.event_id
       or new.created_at is distinct from old.created_at
    then
      raise exception 'AI consent identity cannot be changed' using errcode = '42501';
    end if;
    if new.granted_at is distinct from old.granted_at then
      new.granted_at := now();
    end if;
    if new.withdrawn_at is distinct from old.withdrawn_at and new.withdrawn_at is not null then
      new.withdrawn_at := now();
    end if;
    new.updated_at := now();
    return new;
  end if;

  select * into acct from public.accounts where auth_user_id = new.auth_user_id;
  if not found or acct.account_type <> 'client' or acct.client_id is null then
    raise exception 'AI consent requires the contract client account' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.employees e where e.auth_user_id = new.auth_user_id
  ) then
    raise exception 'Staff cannot grant AI consent' using errcode = '42501';
  end if;
  if new.client_id is distinct from acct.client_id then
    raise exception 'AI consent client does not match the account' using errcode = '42501';
  end if;
  if new.event_guest_id is not null then
    raise exception 'AI consent is not a guest record' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.events e where e.id = new.event_id and e.client_id is not null
  ) then
    if not exists (
      select 1 from public.events e
      where e.id = new.event_id and e.client_id = acct.client_id
    ) then
      raise exception 'AI consent event is not this client contract' using errcode = '42501';
    end if;
  elsif not exists (
    select 1 from public.event_clients ec
    where ec.event_id = new.event_id
      and ec.client_id = acct.client_id
      and (ec.is_contract_holder or ec.is_primary)
  ) then
    raise exception 'AI consent event is not this client contract' using errcode = '42501';
  end if;
  new.created_at := now();
  new.updated_at := now();
  if new.granted_at is not null then
    new.granted_at := now();
  end if;
  new.withdrawn_at := null;
  return new;
end;
$$;

drop trigger if exists ai_consents_enforce on public.ai_consents;
create trigger ai_consents_enforce
  before insert or update on public.ai_consents
  for each row execute function public.ai_consents_enforce();

-- The only write path. client_id is copied from the account. Callers cannot
-- name a guest, another client, or a timestamp.
create or replace function public.ai_consent_save(
  p_auth_user_id uuid,
  p_event_id uuid,
  p_action text,
  p_policy_version text,
  p_source text
)
returns public.ai_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts%rowtype;
  row public.ai_consents;
begin
  if p_action not in ('grant', 'withdraw') then
    raise exception 'AI consent action is not allowed' using errcode = '42501';
  end if;
  if p_source not in ('app', 'web') then
    raise exception 'AI consent source is not allowed' using errcode = '42501';
  end if;
  if p_policy_version is null or btrim(p_policy_version) = '' then
    raise exception 'AI consent policy version is required' using errcode = '42501';
  end if;
  select * into acct from public.accounts where auth_user_id = p_auth_user_id;
  if not found or acct.account_type <> 'client' or acct.client_id is null then
    raise exception 'AI consent requires the contract client account' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.employees e where e.auth_user_id = p_auth_user_id
  ) then
    raise exception 'Staff cannot grant AI consent' using errcode = '42501';
  end if;
  if p_action = 'withdraw' then
    update public.ai_consents
    set withdrawn_at = now(), updated_at = now()
    where auth_user_id = p_auth_user_id and event_id = p_event_id
    returning * into row;
    return row;
  end if;
  insert into public.ai_consents (
    auth_user_id, client_id, event_guest_id, event_id, granted_at, withdrawn_at, policy_version, source
  ) values (
    p_auth_user_id, acct.client_id, null, p_event_id, now(), null, p_policy_version, p_source
  )
  on conflict (auth_user_id, event_id) do update
  set granted_at = now(),
      withdrawn_at = null,
      policy_version = excluded.policy_version,
      source = excluded.source,
      updated_at = now()
  returning * into row;
  return row;
end;
$$;

revoke all on function public.ai_consents_enforce() from public, anon, authenticated, service_role;
revoke all on function public.ai_consent_save(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_consent_save(uuid, uuid, text, text, text) to service_role;

revoke insert, update, delete on table public.ai_consents from service_role;
