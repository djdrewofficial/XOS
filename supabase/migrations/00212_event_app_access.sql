-- Couple app access: invite a partner (or parent, planner, anyone the couple
-- chooses) onto an event, and a short join code the contract holder can share.
--
-- This reuses the existing login model. A couple member is an accounts row of
-- type client whose client is on the event (events.client_id or event_clients).
-- resolveEventRole calls that a host. An event_guests login stays a guest and
-- cannot invite, see the code, or remove people.
--
-- The contact is saved immediately as a clients row plus event_clients, so
-- staff see it on the event before the person ever signs in. The invite stays
-- pending until that person signs in with the same phone or email (the normal
-- one-time code). A trigger on auth.sessions and auth.users claims the invite.
-- Keep that claim function in step with planInviteClaim in src/lib/eventAccess.ts.
--
-- The join code is not stored in plaintext. code_hash is an HMAC for lookup.
-- code_ciphertext is AES-GCM so a couple member can view it again. The key
-- lives in the app (EVENT_JOIN_CODE_KEY, or the service role key if that is
-- unset). Authenticated and anon cannot read the code table.

-- ───────────────────────── Phone match key ─────────────────────────
-- Same rule as phoneMatchKey() in src/lib/eventAccess.ts: digits only, and a
-- leading US country code 1 is dropped so 13055550199 and 3055550199 match.

create or replace function public.xos_phone_digits(p text)
returns text
language sql
immutable
as $$
  select case
    when d is null or d = '' then null
    when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
    else d
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) s;
$$;

revoke all on function public.xos_phone_digits(text) from public, anon, authenticated;
grant execute on function public.xos_phone_digits(text) to service_role;

-- ───────────────────────── Invites ─────────────────────────

create table if not exists public.event_app_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  -- True when this invite inserted that client. Claiming onto an older client
  -- may delete this placeholder if nothing else references it.
  created_client boolean not null default false,
  email text,
  phone text,
  phone_digits text,
  name text,
  role text not null default 'Partner',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_by_name text,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  last_sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_app_invites_contact check (
    email is not null or phone_digits is not null
  )
);

create index if not exists event_app_invites_event_idx
  on public.event_app_invites (event_id, status, invited_at desc);

create unique index if not exists event_app_invites_pending_email
  on public.event_app_invites (event_id, email)
  where status = 'pending' and email is not null;

create unique index if not exists event_app_invites_pending_phone
  on public.event_app_invites (event_id, phone_digits)
  where status = 'pending' and phone_digits is not null;

-- ───────────────────────── Join codes ─────────────────────────

create table if not exists public.event_join_codes (
  event_id uuid primary key references public.events(id) on delete cascade,
  code_hash text not null unique,
  code_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reset_at timestamptz,
  reset_by uuid references auth.users(id) on delete set null
);

create table if not exists public.event_join_attempts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  ip text,
  code_hash text,
  event_id uuid references public.events(id) on delete set null,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists event_join_attempts_user_idx
  on public.event_join_attempts (auth_user_id, created_at desc);
create index if not exists event_join_attempts_ip_idx
  on public.event_join_attempts (ip, created_at desc)
  where ip is not null;

-- ───────────────────────── Host check ─────────────────────────
-- True only for a client login attached to this event. Staff and guests are
-- not hosts. Mobile invite / code / remove routes use the same rule in
-- coupleManageDecision (role === "host").

create or replace function public.xos_is_event_host(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from accounts a
    where a.auth_user_id = auth.uid()
      and a.account_type = 'client'
      and (
        exists (
          select 1 from event_clients ec
          where ec.event_id = p_event_id and ec.client_id = a.client_id
        )
        or exists (
          select 1 from events e
          where e.id = p_event_id and e.client_id = a.client_id
        )
      )
  );
$$;

revoke all on function public.xos_is_event_host(uuid) from public, anon;
grant execute on function public.xos_is_event_host(uuid) to authenticated, service_role;

-- ───────────────────────── RLS ─────────────────────────

alter table public.event_app_invites enable row level security;
alter table public.event_join_codes enable row level security;
alter table public.event_join_attempts enable row level security;

drop policy if exists "staff manage event app invites" on public.event_app_invites;
create policy "staff manage event app invites" on public.event_app_invites
  for all to authenticated
  using (xos_is_staff())
  with check (xos_is_staff());

drop policy if exists "hosts read event app invites" on public.event_app_invites;
create policy "hosts read event app invites" on public.event_app_invites
  for select to authenticated
  using (xos_is_event_host(event_id));

-- No policies on the code or attempt tables: authenticated and anon are denied.
-- The mobile API uses the service role after it has checked the caller.

revoke all on table public.event_join_codes from public, anon, authenticated;
revoke all on table public.event_join_attempts from public, anon, authenticated;
revoke all on table public.event_app_invites from anon;
grant select, insert, update, delete on table public.event_app_invites to authenticated;

-- ───────────────────────── Claim on sign-in ─────────────────────────
-- Returns how many invites were accepted. Never raises for a staff or guest
-- login: those accounts stay as they are (one login, one account type).

create or replace function public.xos_claim_event_app_invites(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_phone text;
  v_type text;
  v_client uuid;
  inv record;
  v_linked int := 0;
  v_ok boolean;
begin
  if p_user_id is null then
    return 0;
  end if;

  select lower(nullif(btrim(email), '')), public.xos_phone_digits(phone)
    into v_email, v_phone
  from auth.users
  where id = p_user_id;

  select account_type, client_id
    into v_type, v_client
  from accounts
  where auth_user_id = p_user_id;

  if v_type in ('staff', 'event_guest') then
    return 0;
  end if;

  if v_email is null and v_phone is null then
    return 0;
  end if;

  for inv in
    select *
    from event_app_invites
    where status = 'pending'
      and expires_at > now()
      and (
        (v_email is not null and email is not null and email = v_email)
        or (
          v_phone is not null
          and phone_digits is not null
          and public.xos_phone_digits(phone_digits) = v_phone
        )
      )
    order by invited_at
  loop
    if inv.client_id is null then
      continue;
    end if;

    v_ok := true;

    if v_client is null then
      begin
        insert into accounts (auth_user_id, account_type, client_id, email, updated_at)
        values (p_user_id, 'client', inv.client_id, v_email, now());
        v_client := inv.client_id;
      exception when unique_violation then
        select a.client_id into v_client
        from accounts a
        where a.auth_user_id = p_user_id
          and a.account_type = 'client';
        if v_client is null then
          v_ok := false;
        end if;
      end;
    end if;

    if not v_ok or v_client is null then
      continue;
    end if;

    if inv.client_id is distinct from v_client then
      insert into event_clients (event_id, client_id, role, is_primary, is_contract_holder)
      values (
        inv.event_id,
        v_client,
        coalesce(nullif(btrim(inv.role), ''), 'Partner'),
        false,
        false
      )
      on conflict (event_id, client_id) do nothing;

      delete from event_clients
      where event_id = inv.event_id
        and client_id = inv.client_id;

      if inv.created_client
         and not exists (select 1 from event_clients ec where ec.client_id = inv.client_id)
         and not exists (select 1 from events e where e.client_id = inv.client_id)
         and not exists (select 1 from accounts a where a.client_id = inv.client_id)
      then
        begin
          delete from clients where id = inv.client_id;
        exception when foreign_key_violation then
          null;
        end;
      end if;
    else
      insert into event_clients (event_id, client_id, role, is_primary, is_contract_holder)
      values (
        inv.event_id,
        v_client,
        coalesce(nullif(btrim(inv.role), ''), 'Partner'),
        false,
        false
      )
      on conflict (event_id, client_id) do nothing;
    end if;

    update event_app_invites
      set status = 'accepted',
          accepted_at = now(),
          accepted_by = p_user_id,
          updated_at = now()
      where id = inv.id
        and status = 'pending';

    v_linked := v_linked + 1;
  end loop;

  return v_linked;
end;
$$;

revoke all on function public.xos_claim_event_app_invites(uuid) from public, anon, authenticated;
grant execute on function public.xos_claim_event_app_invites(uuid) to service_role;

create or replace function public.xos_claim_event_app_invites_from_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.xos_claim_event_app_invites(new.user_id);
  exception when others then
    raise warning 'xos_claim_event_app_invites (session) failed for %', new.user_id;
  end;
  return new;
end;
$$;

create or replace function public.xos_claim_event_app_invites_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.xos_claim_event_app_invites(new.id);
  exception when others then
    raise warning 'xos_claim_event_app_invites (user) failed for %', new.id;
  end;
  return new;
end;
$$;

revoke all on function public.xos_claim_event_app_invites_from_session() from public, anon, authenticated;
revoke all on function public.xos_claim_event_app_invites_from_user() from public, anon, authenticated;

drop trigger if exists xos_claim_invites_on_session on auth.sessions;
create trigger xos_claim_invites_on_session
  after insert on auth.sessions
  for each row
  execute function public.xos_claim_event_app_invites_from_session();

drop trigger if exists xos_claim_invites_on_user on auth.users;
create trigger xos_claim_invites_on_user
  after insert or update of email, phone on auth.users
  for each row
  execute function public.xos_claim_event_app_invites_from_user();

-- GoTrue writes auth.users and auth.sessions as supabase_auth_admin.
grant execute on function public.xos_claim_event_app_invites(uuid) to supabase_auth_admin;
grant execute on function public.xos_claim_event_app_invites_from_session() to supabase_auth_admin, service_role;
grant execute on function public.xos_claim_event_app_invites_from_user() to supabase_auth_admin, service_role;
grant execute on function public.xos_phone_digits(text) to supabase_auth_admin;

comment on table public.event_app_invites is
  'Pending couple-app invites. Claimed when the person signs in with the same phone or email.';
comment on table public.event_join_codes is
  'Per-event join code. Hash for lookup, ciphertext for display. No plaintext column.';
comment on function public.xos_claim_event_app_invites(uuid) is
  'Link pending event app invites to this login. Staff and guest logins are left unchanged.';

-- ───────────────────────── Merge tag ─────────────────────────
-- Filled in TypeScript on the client invite email (like set_password_link),
-- not by render_merge_tags. Listing it here keeps the unknown-tag stripper
-- from deleting <app_join_code> before that injection. The picker reads this row.

insert into public.merge_tags (tag_key, label, group_name, description, is_builtin, source_type, is_active, sort_order)
values (
  'app_join_code',
  'App join code',
  'Account',
  'The event join code for the couple''s app. Filled when the client invite email is sent. Anyone who enters it joins as a partner.',
  true,
  'builtin',
  true,
  2
)
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      is_builtin = true,
      source_type = 'builtin',
      is_active = true;

-- Put the tag on the seeded client invite if Drew has not already placed it.
update public.email_templates
set body_html = body_html || '<app_join_code>'
where name = 'Client Invite / Set Password'
  and coalesce(body_html, '') not like '%app_join_code%';
