-- XOS — multiple clients per event (Contract Holder + additional clients) and client-based notes

create table event_clients (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  role text not null default 'Client', -- e.g. Contract Holder, Bride, Groom, Mother of the Bride, Planner
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_id, client_id)
);

create index event_clients_event_idx on event_clients(event_id);

-- notes that belong to the CLIENT (visible on every event they're part of),
-- e.g. "Mentioned she hates country music"
create table client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index client_notes_client_idx on client_notes(client_id);

alter table event_clients enable row level security;
alter table client_notes enable row level security;
create policy "authenticated full access" on event_clients for all to authenticated using (true) with check (true);
create policy "authenticated full access" on client_notes for all to authenticated using (true) with check (true);

-- backfill: every event's existing client becomes its primary Contract Holder
insert into event_clients (event_id, client_id, role, is_primary)
select id, client_id, 'Contract Holder', true
from events
where client_id is not null
on conflict (event_id, client_id) do nothing;
