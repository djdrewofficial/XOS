-- XOS — equipment asset tracking: purchase info, serial numbers,
-- storage locations, and staff damage reports with photos.

create table equipment_storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into equipment_storage_locations (name) values ('Warehouse'), ('Van / Trailer');

alter table equipment_items add column if not exists date_purchased date;
alter table equipment_items add column if not exists retailer text;
alter table equipment_items add column if not exists serial_number text;
alter table equipment_items add column if not exists storage_location_id uuid references equipment_storage_locations(id);
alter table equipment_systems add column if not exists storage_location_id uuid references equipment_storage_locations(id);

create table equipment_damage_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references equipment_items(id) on delete cascade,
  description text not null,
  reported_by text not null default 'system',
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index equipment_damage_item_idx on equipment_damage_reports(item_id);

-- photos can now also belong to a damage report
alter table equipment_photos add column if not exists damage_report_id uuid references equipment_damage_reports(id) on delete cascade;
alter table equipment_photos drop constraint equipment_photos_check;
alter table equipment_photos add constraint equipment_photos_check
  check (item_id is not null or system_id is not null or damage_report_id is not null);

alter table equipment_storage_locations enable row level security;
alter table equipment_damage_reports enable row level security;
create policy "authenticated full access" on equipment_storage_locations for all to authenticated using (true) with check (true);
create policy "authenticated full access" on equipment_damage_reports for all to authenticated using (true) with check (true);
