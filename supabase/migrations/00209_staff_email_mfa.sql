-- Email one-time codes as a staff second factor.
--
-- Supabase Auth has no email MFA factor. Authenticator and text codes stay
-- native factors (those sessions are aal2). This table stores only an HMAC of
-- an email code: 10 minute life, 5 guesses, 60 seconds between sends, 5 sends
-- an hour, and the code works once for the session that asked for it.
--
-- The browser cannot read or write these tables. The Next.js server calls the
-- functions below with the service role after it has checked the signed-in
-- staff user. Do not grant them to authenticated or anon.
--
-- Apply in the Supabase SQL editor. This file is not applied by the app.

create table public.staff_email_mfa (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  verified_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  constraint staff_email_mfa_email_lowercase check (email = lower(email))
);

create table public.staff_email_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  purpose text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  constraint staff_email_mfa_challenges_purpose check (purpose in ('enroll', 'signin')),
  constraint staff_email_mfa_challenges_hash check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_email_mfa_challenges_attempts check (attempts >= 0 and attempts <= 5)
);

create index staff_email_mfa_challenges_user_created_idx
  on public.staff_email_mfa_challenges (user_id, created_at desc);

comment on table public.staff_email_mfa is
  'Staff logins that proved they can receive a second-factor code at their sign-in email.';
comment on column public.staff_email_mfa_challenges.code_hash is
  'HMAC-SHA256 of the 6-digit code. The code itself is never stored.';

alter table public.staff_email_mfa enable row level security;
alter table public.staff_email_mfa_challenges enable row level security;

revoke all on table public.staff_email_mfa from public, anon, authenticated;
revoke all on table public.staff_email_mfa_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_email_mfa to service_role;
grant select, insert, update, delete on table public.staff_email_mfa_challenges to service_role;

create or replace function public.xos_email_mfa_begin(
  p_user_id uuid,
  p_session_id uuid,
  p_purpose text,
  p_code_hash text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_recent int;
  v_last timestamptz;
  v_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_user_id is null
     or p_session_id is null
     or p_session_id = '00000000-0000-0000-0000-000000000000'::uuid then
    return jsonb_build_object('status', 'bad_session');
  end if;
  if p_purpose is distinct from 'enroll' and p_purpose is distinct from 'signin' then
    return jsonb_build_object('status', 'bad_purpose');
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'bad_hash');
  end if;
  -- The app asks for 10 minutes. Refuse a longer life if a caller gets it wrong.
  if p_expires_at is null
     or p_expires_at <= pg_catalog.now()
     or p_expires_at > pg_catalog.now() + interval '15 minutes' then
    return jsonb_build_object('status', 'bad_expiry');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(p_user_id::text));

  select count(*)::int, max(created_at)
    into v_recent, v_last
  from public.staff_email_mfa_challenges
  where user_id = p_user_id
    and created_at > pg_catalog.now() - interval '1 hour';

  if v_last is not null and v_last > pg_catalog.now() - interval '60 seconds' then
    return jsonb_build_object('status', 'resend');
  end if;
  if coalesce(v_recent, 0) >= 5 then
    return jsonb_build_object('status', 'limited');
  end if;

  -- One live code per purpose. The previous one dies when a new one is sent.
  update public.staff_email_mfa_challenges
     set consumed_at = pg_catalog.now()
   where user_id = p_user_id
     and purpose = p_purpose
     and consumed_at is null;

  insert into public.staff_email_mfa_challenges (user_id, session_id, purpose, code_hash, expires_at)
  values (p_user_id, p_session_id, p_purpose, p_code_hash, p_expires_at)
  returning id into v_id;

  delete from public.staff_email_mfa_challenges
   where user_id = p_user_id
     and created_at < pg_catalog.now() - interval '1 day'
     and id <> v_id;

  return jsonb_build_object('status', 'ok');
end;
$function$;

create or replace function public.xos_email_mfa_consume(
  p_user_id uuid,
  p_session_id uuid,
  p_purpose text,
  p_code_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_hash text;
  v_attempts int;
  v_expires timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(p_user_id::text));

  select id, code_hash, attempts, expires_at
    into v_id, v_hash, v_attempts, v_expires
  from public.staff_email_mfa_challenges
  where user_id = p_user_id
    and session_id = p_session_id
    and purpose = p_purpose
    and consumed_at is null
  order by created_at desc
  limit 1
  for update;

  if v_id is null then
    return jsonb_build_object('status', 'missing');
  end if;
  if v_expires <= pg_catalog.now() then
    update public.staff_email_mfa_challenges
       set consumed_at = pg_catalog.now()
     where id = v_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if v_attempts >= 5 then
    update public.staff_email_mfa_challenges
       set consumed_at = pg_catalog.now()
     where id = v_id;
    return jsonb_build_object('status', 'locked');
  end if;
  if v_hash = p_code_hash then
    update public.staff_email_mfa_challenges
       set consumed_at = pg_catalog.now()
     where id = v_id
       and consumed_at is null;
    return jsonb_build_object('status', 'ok');
  end if;

  update public.staff_email_mfa_challenges
     set attempts = attempts + 1,
         consumed_at = case when attempts + 1 >= 5 then pg_catalog.now() else consumed_at end
   where id = v_id;

  if v_attempts + 1 >= 5 then
    return jsonb_build_object('status', 'locked');
  end if;
  return jsonb_build_object('status', 'mismatch');
end;
$function$;

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
  delete from public.staff_email_mfa where user_id = p_user_id;
  update public.staff_email_mfa_challenges
     set consumed_at = pg_catalog.now()
   where user_id = p_user_id
     and consumed_at is null;
end;
$function$;

revoke all on function public.xos_email_mfa_begin(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.xos_email_mfa_consume(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.xos_email_mfa_clear(uuid) from public, anon, authenticated;
grant execute on function public.xos_email_mfa_begin(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.xos_email_mfa_consume(uuid, uuid, text, text) to service_role;
grant execute on function public.xos_email_mfa_clear(uuid) to service_role;

comment on function public.xos_email_mfa_begin(uuid, uuid, text, text, timestamptz) is
  'Store a hashed email second-factor code for one staff session. service_role only.';
comment on function public.xos_email_mfa_consume(uuid, uuid, text, text) is
  'Check a hashed email code once. Locks after 5 misses. service_role only.';
comment on function public.xos_email_mfa_clear(uuid) is
  'Remove email second factor and burn unused codes. service_role only.';
