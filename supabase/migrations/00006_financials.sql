-- XOS — Financials: package/addon descriptions, event expenses with categories,
-- vehicles + per-event trip tracker.

alter table packages add column if not exists description text;
alter table addons add column if not exists description text;

-- seed the package description visible in DJEP (edit anytime in Supabase / future packages UI)
update packages set description =
'DJ / MC Service for 6 Hours
Simple Dance Floor Lighting
Online Wedding Planning App
Complete Sound System
Wireless Microphone
Monogram Projection
Dancing on the Clouds
2 Cold Spark Machines VTM
Simple Photo Booth with Attendant (4 Hour) OR Uplights
Ceremony Sound System
Meetings with the DJ

(Coverage for Ceremony, Cocktail Hour, Reception OR 6 Hours)'
where name = 'Toscana Xperience Package' and description is null;

-- ============ EXPENSES ============
create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade, -- null = general business expense
  category_id uuid references expense_categories(id),
  payee text,
  description text,
  amount numeric(10,2) not null default 0,
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index expenses_event_idx on expenses(event_id);

insert into expense_categories (name) values
  ('Subcontractor'), ('Equipment Rental'), ('Supplies'), ('Staffing'),
  ('Venue Fees'), ('Fuel / Travel'), ('Other');

-- ============ TRIP TRACKER ============
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

create table event_trips (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  vehicle_id uuid references vehicles(id),
  trip_date date not null default current_date,
  miles numeric(7,1) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index event_trips_event_idx on event_trips(event_id);

alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table vehicles enable row level security;
alter table event_trips enable row level security;
create policy "authenticated full access" on expense_categories for all to authenticated using (true) with check (true);
create policy "authenticated full access" on expenses for all to authenticated using (true) with check (true);
create policy "authenticated full access" on vehicles for all to authenticated using (true) with check (true);
create policy "authenticated full access" on event_trips for all to authenticated using (true) with check (true);

-- ============ AUDIT LOG HOOKS ============
create or replace function log_expense_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.event_id is not null then
      insert into event_logs (event_id, actor, action)
      values (new.event_id, current_actor(), 'Expense added: ' || to_char(new.amount, 'FM$999,999,990.00') || coalesce(' to ' || new.payee, ''));
    end if;
    return new;
  else
    if old.event_id is not null then
      insert into event_logs (event_id, actor, action)
      values (old.event_id, current_actor(), 'Expense removed: ' || to_char(old.amount, 'FM$999,999,990.00'));
    end if;
    return old;
  end if;
end;
$$;

create trigger expenses_log after insert or delete on expenses
  for each row execute function log_expense_changes();

create or replace function log_addon_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from addons where id = new.addon_id;
    insert into event_logs (event_id, actor, action)
    values (new.event_id, current_actor(), 'Add-on added: ' || coalesce(v_name, '?') || ' x' || new.quantity);
    return new;
  else
    select name into v_name from addons where id = old.addon_id;
    insert into event_logs (event_id, actor, action)
    values (old.event_id, current_actor(), 'Add-on removed: ' || coalesce(v_name, '?'));
    return old;
  end if;
end;
$$;

create trigger event_addons_log after insert or delete on event_addons
  for each row execute function log_addon_changes();
