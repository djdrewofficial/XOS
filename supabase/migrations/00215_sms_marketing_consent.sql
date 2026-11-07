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

revoke all on table public.sms_marketing_consent_events from public, anon, authenticated, service_role;
grant select on table public.sms_marketing_consent_events to authenticated, service_role;

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

-- Same US E.164 rules as src/lib/smsMarketingConsent.ts. A grant can only
-- name the booking mobile already stored on clients.cell_phone.
create or replace function public.xos_phone_e164(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null then
    return null;
  end if;
  digits := regexp_replace(raw, '\D', '', 'g');
  if left(btrim(raw), 1) = '+' then
    if length(digits) < 10 then
      return null;
    end if;
    return '+' || digits;
  end if;
  if length(digits) = 10 then
    return '+1' || digits;
  end if;
  if length(digits) = 11 and left(digits, 1) = '1' then
    return '+' || digits;
  end if;
  return null;
end;
$$;

create or replace function public.sms_marketing_consent_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts%rowtype;
  cell text;
  phone text;
  prior text;
begin
  if tg_op = 'DELETE' then
    -- auth.users ON DELETE CASCADE removes this login's history during app
    -- account deletion. A direct delete, including from the table owner, is rejected.
    -- The cascade statement runs inside the parent constraint trigger.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'SMS marketing consent history cannot be changed' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- clients ON DELETE SET NULL and events ON DELETE SET NULL clear only that
    -- foreign key. Phone, actor, action, and timestamp stay. A direct update
    -- is rejected, including a hand-written SET NULL.
    if pg_trigger_depth() > 1
       and new.id is not distinct from old.id
       and new.auth_user_id is not distinct from old.auth_user_id
       and new.phone_e164 is not distinct from old.phone_e164
       and new.action is not distinct from old.action
       and new.disclosure_version is not distinct from old.disclosure_version
       and new.source is not distinct from old.source
       and new.created_at is not distinct from old.created_at
       and (new.client_id is not distinct from old.client_id or new.client_id is null)
       and (new.event_id is not distinct from old.event_id or new.event_id is null)
       and (
         new.client_id is distinct from old.client_id
         or new.event_id is distinct from old.event_id
       )
    then
      return new;
    end if;
    raise exception 'SMS marketing consent history cannot be changed' using errcode = '42501';
  end if;
  select * into acct from public.accounts where auth_user_id = new.auth_user_id;
  if not found or acct.account_type <> 'client' or acct.client_id is null then
    raise exception 'SMS marketing consent requires the client account' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.employees e where e.auth_user_id = new.auth_user_id
  ) then
    raise exception 'Staff cannot record SMS marketing consent' using errcode = '42501';
  end if;
  if new.client_id is distinct from acct.client_id then
    raise exception 'SMS marketing consent client does not match the account' using errcode = '42501';
  end if;
  if new.event_id is not null and not (
    exists (
      select 1 from public.events e
      where e.id = new.event_id and e.client_id = acct.client_id
    )
    or exists (
      select 1 from public.event_clients ec
      where ec.event_id = new.event_id and ec.client_id = acct.client_id
    )
  ) then
    raise exception 'SMS marketing consent event is not this client' using errcode = '42501';
  end if;
  select c.cell_phone into cell from public.clients c where c.id = acct.client_id;
  phone := public.xos_phone_e164(cell);
  if phone is not null then
    if new.phone_e164 is distinct from phone then
      raise exception 'SMS marketing consent phone does not match the booking mobile' using errcode = '42501';
    end if;
  else
    if new.action <> 'withdraw' then
      raise exception 'SMS marketing consent requires the booking mobile' using errcode = '42501';
    end if;
    select e.phone_e164 into prior
    from public.sms_marketing_consent_events e
    where e.auth_user_id = new.auth_user_id
    order by e.created_at desc
    limit 1;
    if prior is null or new.phone_e164 is distinct from prior then
      raise exception 'SMS marketing consent phone does not match the booking mobile' using errcode = '42501';
    end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- The only write path. Phone and client come from the account, not the caller.
create or replace function public.sms_marketing_consent_record(
  p_auth_user_id uuid,
  p_event_id uuid,
  p_action text,
  p_disclosure_version text,
  p_source text
)
returns public.sms_marketing_consent_events
language plpgsql
security definer
set search_path = public
as $$
declare
  acct public.accounts%rowtype;
  phone text;
  row public.sms_marketing_consent_events;
begin
  if p_action not in ('grant', 'withdraw') then
    raise exception 'SMS marketing consent action is not allowed' using errcode = '42501';
  end if;
  if p_source not in ('app', 'web') then
    raise exception 'SMS marketing consent source is not allowed' using errcode = '42501';
  end if;
  if p_disclosure_version is null or btrim(p_disclosure_version) = '' then
    raise exception 'SMS marketing consent disclosure is required' using errcode = '42501';
  end if;
  select * into acct from public.accounts where auth_user_id = p_auth_user_id;
  if not found or acct.account_type <> 'client' or acct.client_id is null then
    raise exception 'SMS marketing consent requires the client account' using errcode = '42501';
  end if;
  select public.xos_phone_e164(c.cell_phone) into phone
  from public.clients c
  where c.id = acct.client_id;
  if phone is null and p_action = 'withdraw' then
    select e.phone_e164 into phone
    from public.sms_marketing_consent_events e
    where e.auth_user_id = p_auth_user_id
    order by e.created_at desc
    limit 1;
  end if;
  if phone is null then
    return null;
  end if;
  insert into public.sms_marketing_consent_events (
    auth_user_id, client_id, event_id, phone_e164, action, disclosure_version, source
  ) values (
    p_auth_user_id, acct.client_id, p_event_id, phone, p_action, p_disclosure_version, p_source
  )
  returning * into row;
  return row;
end;
$$;

drop trigger if exists sms_marketing_consent_enforce on public.sms_marketing_consent_events;
create trigger sms_marketing_consent_enforce
  before insert or update or delete on public.sms_marketing_consent_events
  for each row execute function public.sms_marketing_consent_enforce();

revoke all on function public.xos_phone_e164(text) from public, anon, authenticated;
revoke all on function public.sms_marketing_consent_enforce() from public, anon, authenticated, service_role;
revoke all on function public.sms_marketing_consent_record(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sms_marketing_consent_record(uuid, uuid, text, text, text) to service_role;
