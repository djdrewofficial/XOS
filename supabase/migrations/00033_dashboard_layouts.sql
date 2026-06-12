-- XOS — per-role dashboard layouts (Application → Dashboard Layout builder).
-- One row per permission tier; widgets is an ordered jsonb array of {id, size}.

create table if not exists dashboard_layouts (
  role text primary key
    check (role in ('master_admin', 'admin', 'salesperson', 'employee')),
  widgets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table dashboard_layouts enable row level security;
do $$ begin
  create policy "authenticated full access" on dashboard_layouts
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

insert into dashboard_layouts (role, widgets) values
  ('master_admin', '[{"id":"stat_cards","size":"full"},{"id":"calendar","size":"full"},{"id":"upcoming_events","size":"half"},{"id":"recent_payments","size":"half"}]'),
  ('admin',        '[{"id":"stat_cards","size":"full"},{"id":"calendar","size":"full"},{"id":"upcoming_events","size":"half"},{"id":"recent_payments","size":"half"}]'),
  ('salesperson',  '[{"id":"stat_cards","size":"full"},{"id":"calendar","size":"full"},{"id":"upcoming_events","size":"half"},{"id":"quick_actions","size":"half"}]'),
  ('employee',     '[{"id":"my_upcoming_events","size":"full"},{"id":"calendar","size":"full"}]')
on conflict (role) do nothing;
