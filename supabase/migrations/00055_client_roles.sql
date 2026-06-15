-- XOS — managed "client role" labels (Contract Holder, Partner A, Partner B …)
-- used when attaching clients to an event. Managed under Settings → Custom Fields.
create table if not exists client_role_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into client_role_definitions (name, sort_order) values
  ('Contract Holder', 1),
  ('Partner A', 2),
  ('Partner B', 3),
  ('Planner', 4),
  ('Parent', 5),
  ('Client', 6)
on conflict do nothing;

alter table client_role_definitions enable row level security;
do $$ begin
  create policy "authenticated full access" on client_role_definitions
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;
