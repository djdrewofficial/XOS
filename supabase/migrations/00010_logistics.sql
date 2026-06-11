-- XOS — logistics: equipment items, systems (racks/cases of gear), QR codes,
-- per-event equipment checklist with packed / checked-out / checked-in states.

create table equipment_systems (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  qr_code text not null unique default 'XS-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table equipment_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  system_id uuid references equipment_systems(id) on delete set null, -- lives inside this rack/case
  qr_code text not null unique default 'XI-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table event_equipment (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  item_id uuid references equipment_items(id) on delete cascade,
  system_id uuid references equipment_systems(id) on delete cascade,
  quantity int not null default 1,
  notes text,
  packed boolean not null default false,        -- checklist: prepped & in the van
  checked_out_at timestamptz,                   -- left the warehouse
  checked_in_at timestamptz,                    -- back in the warehouse
  created_at timestamptz not null default now(),
  check (item_id is not null or system_id is not null)
);
create index event_equipment_event_idx on event_equipment(event_id);

alter table equipment_systems enable row level security;
alter table equipment_items enable row level security;
alter table event_equipment enable row level security;
create policy "authenticated full access" on equipment_systems for all to authenticated using (true) with check (true);
create policy "authenticated full access" on equipment_items for all to authenticated using (true) with check (true);
create policy "authenticated full access" on event_equipment for all to authenticated using (true) with check (true);

-- logistics notes on events
alter table event_notes drop constraint event_notes_kind_check;
alter table event_notes add constraint event_notes_kind_check
  check (kind in ('internal', 'contract', 'logistics'));

-- audit log
create or replace function log_event_equipment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    if new.item_id is not null then
      select name into v_name from equipment_items where id = new.item_id;
    else
      select name into v_name from equipment_systems where id = new.system_id;
    end if;
    insert into event_logs (event_id, actor, action)
    values (new.event_id, current_actor(), 'Equipment assigned: ' || coalesce(v_name, '?') || ' x' || new.quantity);
    return new;
  elsif tg_op = 'DELETE' then
    if old.item_id is not null then
      select name into v_name from equipment_items where id = old.item_id;
    else
      select name into v_name from equipment_systems where id = old.system_id;
    end if;
    insert into event_logs (event_id, actor, action)
    values (old.event_id, current_actor(), 'Equipment removed: ' || coalesce(v_name, '?'));
    return old;
  else
    if old.checked_out_at is distinct from new.checked_out_at and new.checked_out_at is not null then
      if new.item_id is not null then
        select name into v_name from equipment_items where id = new.item_id;
      else
        select name into v_name from equipment_systems where id = new.system_id;
      end if;
      insert into event_logs (event_id, actor, action)
      values (new.event_id, current_actor(), 'Equipment checked out: ' || coalesce(v_name, '?'));
    end if;
    if old.checked_in_at is distinct from new.checked_in_at and new.checked_in_at is not null then
      if new.item_id is not null then
        select name into v_name from equipment_items where id = new.item_id;
      else
        select name into v_name from equipment_systems where id = new.system_id;
      end if;
      insert into event_logs (event_id, actor, action)
      values (new.event_id, current_actor(), 'Equipment checked in: ' || coalesce(v_name, '?'));
    end if;
    return new;
  end if;
end;
$$;

create trigger event_equipment_log after insert or update or delete on event_equipment
  for each row execute function log_event_equipment_changes();

-- starter categories worth of gear (edit freely)
insert into equipment_systems (name, description) values
  ('Main DJ Rack', 'Primary controller rack: mixer, wireless mics, cabling'),
  ('Photo Booth Case', 'Photo booth, printer, props case');

insert into equipment_items (name, category) values
  ('LED Dance Floor Panels (18x18)', 'Dance Floor'),
  ('Cold Spark Machine #1', 'Effects'),
  ('Cold Spark Machine #2', 'Effects'),
  ('Dancing on the Clouds Machine', 'Effects'),
  ('Uplights (set of 8)', 'Lighting'),
  ('Ceremony Speaker Kit', 'Audio');
