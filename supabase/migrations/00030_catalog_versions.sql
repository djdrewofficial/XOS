-- XOS — package/addon version history + price locking.
-- Rule: once a package or add-on is assigned to an event, later catalog changes
-- (price, description, anything) must NOT reprice that event. Events pin the
-- version they were sold with; editors choose "update current version" (typo fix)
-- or "create new version" on every save.

-- ============ VERSION TABLES ============
alter table packages add column if not exists current_version int not null default 1;
alter table addons add column if not exists current_version int not null default 1;

create table if not exists package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  version_no int not null,
  snapshot jsonb not null,           -- full packages row at save time
  created_at timestamptz not null default now(),
  unique (package_id, version_no)
);

create table if not exists addon_versions (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references addons(id) on delete cascade,
  version_no int not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (addon_id, version_no)
);

alter table package_versions enable row level security;
alter table addon_versions enable row level security;
do $$ begin
  create policy "authenticated full access" on package_versions
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "authenticated full access" on addon_versions
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- seed v1 snapshots for everything that exists today
insert into package_versions (package_id, version_no, snapshot)
select p.id, p.current_version, to_jsonb(p)
from packages p
where not exists (
  select 1 from package_versions v where v.package_id = p.id and v.version_no = p.current_version
);

insert into addon_versions (addon_id, version_no, snapshot)
select a.id, a.current_version, to_jsonb(a)
from addons a
where not exists (
  select 1 from addon_versions v where v.addon_id = a.id and v.version_no = a.current_version
);

-- ============ PRICE LOCKING ON EVENTS ============
-- The price (and version) are copied onto the event the moment the package/add-on
-- is assigned. Display/calculation order everywhere: override → locked → live default.
alter table events add column if not exists package_price_locked numeric(10,2);
alter table events add column if not exists package_version_no int;
alter table event_addons add column if not exists price_locked numeric(10,2);
alter table event_addons add column if not exists addon_version_no int;

create or replace function lock_event_package()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare p packages%rowtype;
begin
  if new.package_id is null then
    new.package_price_locked := null;
    new.package_version_no := null;
    return new;
  end if;
  if tg_op = 'INSERT' or new.package_id is distinct from old.package_id then
    select * into p from packages where id = new.package_id;
    if found then
      new.package_price_locked := p.default_price;
      new.package_version_no := p.current_version;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists events_lock_package on events;
create trigger events_lock_package
  before insert or update of package_id on events
  for each row execute function lock_event_package();

create or replace function lock_event_addon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare a addons%rowtype;
begin
  if tg_op = 'INSERT' or new.addon_id is distinct from old.addon_id then
    select * into a from addons where id = new.addon_id;
    if found then
      new.price_locked := a.default_price;
      new.addon_version_no := a.current_version;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists event_addons_lock on event_addons;
create trigger event_addons_lock
  before insert or update of addon_id on event_addons
  for each row execute function lock_event_addon();

-- backfill events/add-ons that predate locking (pin them to today's price = current behavior)
update events e
set package_price_locked = p.default_price,
    package_version_no = p.current_version
from packages p
where p.id = e.package_id and e.package_price_locked is null;

update event_addons ea
set price_locked = a.default_price,
    addon_version_no = a.current_version
from addons a
where a.id = ea.addon_id and ea.price_locked is null;
