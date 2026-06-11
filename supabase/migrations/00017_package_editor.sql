-- XOS — package editor: client-facing name, deposit %, weekday pricing,
-- custom date-range pricing (highest priority), default add-ons and equipment.

alter table packages add column if not exists client_facing_name text;
alter table packages add column if not exists notes text;
-- percentage-based deposit option; when set it wins over deposit_value
alter table packages add column if not exists deposit_pct numeric(5,2);
-- optional price per day of week: {"0": 1800, "5": 2200} keys 0=Sun … 6=Sat
alter table packages add column if not exists weekday_prices jsonb not null default '{}'::jsonb;

-- custom date range pricing — OVERRULES weekday and default pricing
create table package_date_prices (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  label text, -- e.g. "NYE 2026", "Peak Season"
  start_date date not null,
  end_date date not null,
  price numeric(10,2) not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index package_date_prices_pkg_idx on package_date_prices(package_id);

-- add-ons auto-assigned (with quantity) when this package is selected on an event
create table package_addon_defaults (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  addon_id uuid not null references addons(id) on delete cascade,
  quantity int not null default 1,
  unique (package_id, addon_id)
);

-- equipment auto-assigned to the event's logistics checklist when this package is selected
create table package_equipment_defaults (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  item_id uuid references equipment_items(id) on delete cascade,
  system_id uuid references equipment_systems(id) on delete cascade,
  quantity int not null default 1,
  check (item_id is not null or system_id is not null)
);
create index package_equipment_defaults_pkg_idx on package_equipment_defaults(package_id);

alter table package_date_prices enable row level security;
alter table package_addon_defaults enable row level security;
alter table package_equipment_defaults enable row level security;
create policy "authenticated full access" on package_date_prices for all to authenticated using (true) with check (true);
create policy "authenticated full access" on package_addon_defaults for all to authenticated using (true) with check (true);
create policy "authenticated full access" on package_equipment_defaults for all to authenticated using (true) with check (true);
