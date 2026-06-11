-- XOS — manageable package categories, add-on categories, add-on editor with
-- assigned equipment (auto-added to logistics when the add-on is attached to an event).

alter table package_categories add column if not exists is_active boolean not null default true;

create table addon_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table addons add column if not exists category_id uuid references addon_categories(id);
alter table addons add column if not exists client_facing_name text;
alter table addons add column if not exists notes text;

-- migrate existing free-text addon categories
insert into addon_categories (name)
select distinct trim(category) from addons
where category is not null and trim(category) <> ''
on conflict (name) do nothing;

update addons a
set category_id = c.id
from addon_categories c
where a.category is not null and trim(a.category) = c.name and a.category_id is null;

-- equipment auto-assigned to the event logistics checklist when this add-on is attached
create table addon_equipment_defaults (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references addons(id) on delete cascade,
  item_id uuid references equipment_items(id) on delete cascade,
  system_id uuid references equipment_systems(id) on delete cascade,
  quantity int not null default 1,
  check (item_id is not null or system_id is not null)
);
create index addon_equipment_defaults_addon_idx on addon_equipment_defaults(addon_id);

alter table addon_categories enable row level security;
alter table addon_equipment_defaults enable row level security;
create policy "authenticated full access" on addon_categories for all to authenticated using (true) with check (true);
create policy "authenticated full access" on addon_equipment_defaults for all to authenticated using (true) with check (true);
