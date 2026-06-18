-- XOS — unified login accounts + Event Guest entity (foundation for the in-house
-- music/timeline planning portal that replaces Vibo).
--
-- `accounts` is the SINGLE source of truth for "who is this logged-in user":
-- every auth.users row that can sign in maps to exactly one account, tagged with
-- a type and linked to its domain row (employee / client / event_guest).
--   staff       → employees   (admin app + the Permissions matrix)
--   client      → clients      (planning portal)
--   event_guest → event_guests (planning portal, scoped to one event)
-- employees.auth_user_id stays for back-compat; accounts is authoritative going forward.

-- Guests of a specific event (can be invited to collaborate on music/timeline).
create table if not exists event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  relationship text,            -- e.g. 'Maid of Honor', 'Family', 'Guest'
  created_at timestamptz not null default now()
);
create index if not exists event_guests_event_idx on event_guests(event_id);

create table if not exists accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  account_type text not null check (account_type in ('staff', 'client', 'event_guest')),
  employee_id uuid references employees(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  event_guest_id uuid references event_guests(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the linked row must match the declared type
  check (
    (account_type = 'staff'       and employee_id    is not null) or
    (account_type = 'client'      and client_id      is not null) or
    (account_type = 'event_guest' and event_guest_id is not null)
  )
);

-- one login per domain row
create unique index if not exists accounts_employee_uidx    on accounts(employee_id)    where employee_id is not null;
create unique index if not exists accounts_client_uidx      on accounts(client_id)      where client_id is not null;
create unique index if not exists accounts_event_guest_uidx on accounts(event_guest_id) where event_guest_id is not null;

-- RLS. NOTE: this follows XOS's existing "authenticated full access" pattern.
-- Once external (client / event_guest) users have real logins, that pattern lets
-- ANY authenticated user read other tables via the API — so per-type RLS scoping
-- is a REQUIRED follow-up before the portal exposes real client data. Tracked in
-- the accounts memory note.
alter table accounts enable row level security;
alter table event_guests enable row level security;
do $$ begin
  create policy "authenticated full access" on accounts
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on event_guests
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Backfill: any employee already linked to an auth user gets a staff account row.
insert into accounts (auth_user_id, account_type, employee_id, email)
select e.auth_user_id, 'staff', e.id, e.email
from employees e
where e.auth_user_id is not null
on conflict (auth_user_id) do nothing;
