-- Staff passkeys (WebAuthn).
--
-- Supabase Auth has no passkey factor. A passkey is stored here. After the
-- Next.js server verifies the ceremony (origin, RP ID, challenge, user
-- verification, signature, counter), it opens a real Supabase session and
-- sets the same kind of signed, session-bound proof the email factor uses.
-- A passkey sign-in is fully verified on its own. Password plus a code still
-- works. An account is not allowed to end up with neither a passkey nor a
-- second factor.
--
-- Challenges live in the database, work once, and expire within 5 minutes.
-- The browser cannot read or write these tables. Do not grant the functions
-- to authenticated or anon.
--
-- Apply in the Supabase SQL editor. This file is not applied by the app.

create table public.staff_passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text not null default 'singleDevice',
  backed_up boolean not null default false,
  name text not null,
  rp_id text not null,
  created_at timestamptz not null default pg_catalog.now(),
  last_used_at timestamptz,
  constraint staff_passkeys_credential_id check (credential_id ~ '^[A-Za-z0-9_-]{16,512}$'),
  constraint staff_passkeys_public_key check (public_key ~ '^[A-Za-z0-9_-]{16,4096}$'),
  constraint staff_passkeys_counter check (counter >= 0),
  constraint staff_passkeys_device_type check (device_type in ('singleDevice', 'multiDevice')),
  constraint staff_passkeys_name check (char_length(name) between 1 and 80 and name = btrim(name)),
  constraint staff_passkeys_rp_id check (char_length(rp_id) between 1 and 253 and rp_id !~ '\s')
);

create unique index staff_passkeys_credential_id_uidx on public.staff_passkeys (credential_id);
create index staff_passkeys_user_idx on public.staff_passkeys (user_id, created_at desc);

comment on table public.staff_passkeys is
  'Discoverable passkeys for staff sign-in. The public key never leaves the server.';
comment on column public.staff_passkeys.counter is
  'Signature counter. Zero means the authenticator does not count uses (synced passkeys). A later use must be higher once it has ever been above zero.';
comment on column public.staff_passkeys.rp_id is
  'Relying party ID this passkey was created for. Production and a deploy preview do not share passkeys.';

create table public.staff_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  session_id uuid,
  kind text not null,
  challenge text not null,
  origin text not null,
  rp_id text not null,
  ip_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint staff_passkey_challenges_kind check (kind in ('register', 'authenticate')),
  constraint staff_passkey_challenges_challenge check (challenge ~ '^[A-Za-z0-9_-]{32,128}$'),
  constraint staff_passkey_challenges_ip check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_passkey_challenges_rp check (char_length(rp_id) between 1 and 253)
);

create unique index staff_passkey_challenges_challenge_uidx
  on public.staff_passkey_challenges (challenge);
create index staff_passkey_challenges_user_created_idx
  on public.staff_passkey_challenges (user_id, created_at desc);

comment on table public.staff_passkey_challenges is
  'One-time WebAuthn challenges. Five minute life. Discoverable sign-in has no user until the passkey comes back.';

alter table public.staff_passkeys enable row level security;
alter table public.staff_passkey_challenges enable row level security;

revoke all on table public.staff_passkeys from public, anon, authenticated;
revoke all on table public.staff_passkey_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_passkeys to service_role;
grant select, insert, update, delete on table public.staff_passkey_challenges to service_role;

create or replace function public.xos_passkey_challenge_begin(
  p_user_id uuid,
  p_session_id uuid,
  p_kind text,
  p_challenge text,
  p_origin text,
  p_rp_id text,
  p_expires_at timestamptz,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_recent int;
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_kind is distinct from 'register' and p_kind is distinct from 'authenticate' then
    return jsonb_build_object('status', 'bad_kind');
  end if;
  if p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('status', 'bad_challenge');
  end if;
  if p_origin is null or char_length(p_origin) < 8 or char_length(p_origin) > 200
     or p_rp_id is null or char_length(p_rp_id) < 1 or char_length(p_rp_id) > 253
     or p_rp_id ~ '\s' then
    return jsonb_build_object('status', 'bad_origin');
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'bad_ip');
  end if;
  -- The app asks for 5 minutes. Refuse a longer life if a caller gets it wrong.
  if p_expires_at is null
     or p_expires_at <= pg_catalog.now()
     or p_expires_at > pg_catalog.now() + interval '5 minutes' then
    return jsonb_build_object('status', 'bad_expiry');
  end if;

  if p_kind = 'register' then
    if p_user_id is null or p_session_id is null
       or p_session_id = '00000000-0000-0000-0000-000000000000'::uuid then
      return jsonb_build_object('status', 'bad_session');
    end if;
  elsif p_user_id is null then
    if p_session_id is not null then
      return jsonb_build_object('status', 'bad_session');
    end if;
  elsif p_session_id is null
        or p_session_id = '00000000-0000-0000-0000-000000000000'::uuid then
    return jsonb_build_object('status', 'bad_session');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(coalesce(p_user_id::text, p_ip_hash, 'passkey-anon'))
  );

  if p_user_id is not null then
    select count(*)::int into v_recent
    from public.staff_passkey_challenges
    where user_id = p_user_id
      and kind = p_kind
      and created_at > pg_catalog.now() - interval '1 hour';
    if p_kind = 'register' and coalesce(v_recent, 0) >= 10 then
      return jsonb_build_object('status', 'limited');
    end if;
    if p_kind = 'authenticate' and coalesce(v_recent, 0) >= 30 then
      return jsonb_build_object('status', 'limited');
    end if;
  elsif p_ip_hash is not null then
    select count(*)::int into v_recent
    from public.staff_passkey_challenges
    where ip_hash = p_ip_hash
      and user_id is null
      and created_at > pg_catalog.now() - interval '1 hour';
    if coalesce(v_recent, 0) >= 60 then
      return jsonb_build_object('status', 'limited');
    end if;
  else
    select count(*)::int into v_recent
    from public.staff_passkey_challenges
    where user_id is null
      and ip_hash is null
      and created_at > pg_catalog.now() - interval '1 hour';
    if coalesce(v_recent, 0) >= 30 then
      return jsonb_build_object('status', 'limited');
    end if;
  end if;

  insert into public.staff_passkey_challenges (
    user_id, session_id, kind, challenge, origin, rp_id, ip_hash, expires_at
  ) values (
    p_user_id, p_session_id, p_kind, p_challenge, p_origin, p_rp_id, p_ip_hash, p_expires_at
  )
  returning id into v_id;

  delete from public.staff_passkey_challenges
   where created_at < pg_catalog.now() - interval '1 day'
     and id <> v_id
     and (user_id is not distinct from p_user_id or (p_user_id is null and ip_hash is not distinct from p_ip_hash));

  return jsonb_build_object('status', 'ok');
end;
$function$;

create or replace function public.xos_passkey_challenge_consume(
  p_challenge text,
  p_kind text,
  p_user_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_user uuid;
  v_session uuid;
  v_kind text;
  v_origin text;
  v_rp text;
  v_expires timestamptz;
  v_consumed timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('status', 'missing');
  end if;

  select id, user_id, session_id, kind, origin, rp_id, expires_at, consumed_at
    into v_id, v_user, v_session, v_kind, v_origin, v_rp, v_expires, v_consumed
  from public.staff_passkey_challenges
  where challenge = p_challenge
  for update;

  if v_id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_consumed is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_expires <= pg_catalog.now() then
    update public.staff_passkey_challenges
       set consumed_at = pg_catalog.now()
     where id = v_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if v_kind is distinct from p_kind then
    return jsonb_build_object('status', 'kind');
  end if;

  -- Register and step-up are bound to the staff session that asked.
  -- Discoverable sign-in is not bound to a user yet.
  if p_kind = 'register' or p_user_id is not null then
    if v_user is distinct from p_user_id or v_session is distinct from p_session_id then
      return jsonb_build_object('status', 'owner');
    end if;
  elsif v_user is not null or v_session is not null then
    return jsonb_build_object('status', 'owner');
  end if;

  update public.staff_passkey_challenges
     set consumed_at = pg_catalog.now()
   where id = v_id
     and consumed_at is null;

  if not found then
    return jsonb_build_object('status', 'used');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'origin', v_origin,
    'rp_id', v_rp,
    'user_id', v_user,
    'session_id', v_session
  );
end;
$function$;

create or replace function public.xos_passkey_note_use(
  p_credential_id text,
  p_new_counter bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_counter bigint;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_credential_id is null or p_new_counter is null or p_new_counter < 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select id, counter
    into v_id, v_counter
  from public.staff_passkeys
  where credential_id = p_credential_id
  for update;

  if v_id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  -- Synced passkeys (iCloud, 1Password) often stay at 0. Once a counter has
  -- moved, a repeat or a lower value means the authenticator was cloned.
  if v_counter > 0 and p_new_counter <= v_counter then
    return jsonb_build_object('status', 'clone');
  end if;
  if p_new_counter < v_counter then
    return jsonb_build_object('status', 'clone');
  end if;

  update public.staff_passkeys
     set counter = p_new_counter,
         last_used_at = pg_catalog.now()
   where id = v_id;

  return jsonb_build_object('status', 'ok');
end;
$function$;

-- True when this login still has a passkey, a verified Supabase factor, or
-- (when asked) the email second factor, ignoring the row being removed.
create or replace function public.xos_has_sign_in_method(
  p_user_id uuid,
  p_ignore_passkey uuid,
  p_ignore_factor uuid,
  p_count_email boolean
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from public.staff_passkeys
      where user_id = p_user_id
        and (p_ignore_passkey is null or id <> p_ignore_passkey)
    )
    or exists (
      select 1
      from auth.mfa_factors
      where user_id = p_user_id
        and status = 'verified'
        and (p_ignore_factor is null or id <> p_ignore_factor)
    )
    or (
      coalesce(p_count_email, false)
      and exists (
        select 1 from public.staff_email_mfa where user_id = p_user_id
      )
    );
$function$;

-- Account deletion cascades into passkeys and factors. Mark the user first so
-- those guards do not block the delete.
create or replace function public.xos_passkey_mark_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform pg_catalog.set_config('xos.deleting_user', old.id::text, true);
  return old;
end;
$function$;

create or replace function public.xos_keep_last_passkey()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('xos.deleting_user', true) is not distinct from old.user_id::text then
    return old;
  end if;
  if public.xos_has_sign_in_method(old.user_id, old.id, null, true) then
    return old;
  end if;
  raise exception 'last_method' using errcode = '23514';
end;
$function$;

create or replace function public.xos_keep_last_factor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('xos.deleting_user', true) is not distinct from old.user_id::text then
    return old;
  end if;
  if old.status is distinct from 'verified' then
    return old;
  end if;
  if public.xos_has_sign_in_method(old.user_id, null, old.id, true) then
    return old;
  end if;
  raise exception 'last_method' using errcode = '23514';
end;
$function$;

drop trigger if exists xos_passkey_user_delete on auth.users;
create trigger xos_passkey_user_delete
  before delete on auth.users
  for each row
  execute function public.xos_passkey_mark_user_delete();

drop trigger if exists xos_keep_last_passkey on public.staff_passkeys;
create trigger xos_keep_last_passkey
  before delete on public.staff_passkeys
  for each row
  execute function public.xos_keep_last_passkey();

drop trigger if exists xos_keep_last_factor on auth.mfa_factors;
create trigger xos_keep_last_factor
  before delete on auth.mfa_factors
  for each row
  execute function public.xos_keep_last_factor();

-- Email was the only custom factor before passkeys. Turning it off now has
-- to leave a passkey or a verified authenticator / text factor.
create or replace function public.xos_email_mfa_clear(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.xos_has_sign_in_method(p_user_id, null, null, false) then
    raise exception 'last_method' using errcode = '23514';
  end if;
  delete from public.staff_email_mfa where user_id = p_user_id;
  update public.staff_email_mfa_challenges
     set consumed_at = pg_catalog.now()
   where user_id = p_user_id
     and consumed_at is null;
end;
$function$;

revoke all on function public.xos_passkey_challenge_begin(uuid, uuid, text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.xos_passkey_challenge_consume(text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.xos_passkey_note_use(text, bigint) from public, anon, authenticated;
revoke all on function public.xos_has_sign_in_method(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.xos_passkey_mark_user_delete() from public, anon, authenticated;
revoke all on function public.xos_keep_last_passkey() from public, anon, authenticated;
revoke all on function public.xos_keep_last_factor() from public, anon, authenticated;

grant execute on function public.xos_passkey_challenge_begin(uuid, uuid, text, text, text, text, timestamptz, text) to service_role;
grant execute on function public.xos_passkey_challenge_consume(text, text, uuid, uuid) to service_role;
grant execute on function public.xos_passkey_note_use(text, bigint) to service_role;

-- GoTrue deletes auth.users and auth.mfa_factors as supabase_auth_admin. The
-- guards are triggers, so that role has to be allowed to run them. Calling
-- them directly does nothing useful: PostgreSQL only runs a trigger function
-- as a trigger. The last-method rule is inside the function.
grant execute on function public.xos_passkey_mark_user_delete() to supabase_auth_admin, service_role;
grant execute on function public.xos_keep_last_passkey() to supabase_auth_admin, service_role;
grant execute on function public.xos_keep_last_factor() to supabase_auth_admin, service_role;

comment on function public.xos_passkey_challenge_begin(uuid, uuid, text, text, text, text, timestamptz, text) is
  'Store a 5-minute WebAuthn challenge. service_role only.';
comment on function public.xos_passkey_challenge_consume(text, text, uuid, uuid) is
  'Mark a WebAuthn challenge used. A second call fails. service_role only.';
comment on function public.xos_passkey_note_use(text, bigint) is
  'Advance a passkey signature counter, or refuse a cloned authenticator. service_role only.';
