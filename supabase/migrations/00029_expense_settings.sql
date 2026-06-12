-- XOS — expense settings (DJEP "Add Expense Options" parity) + automatic mileage expenses.
-- Venues already carry distance_miles; flipping auto_mileage on a venue makes every event
-- booked there generate a mileage expense automatically.

create table if not exists expense_settings (
  id boolean primary key default true check (id),

  -- payee dropdown options when entering an expense (DJEP "Payee" option list)
  payees text[] not null default array[]::text[],

  -- AUTO MILEAGE
  auto_mileage_enabled boolean not null default false,
  mileage_rate numeric(6, 3) not null default 0.700,   -- $ per mile (IRS 2026 standard)
  mileage_round_trip boolean not null default true,    -- distance counted both ways
  mileage_category_id uuid references expense_categories(id) on delete set null,

  updated_at timestamptz not null default now()
);

insert into expense_settings (id, mileage_category_id)
values (true, (select id from expense_categories where name = 'Fuel / Travel' limit 1))
on conflict (id) do nothing;

alter table expense_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on expense_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- per-venue switch (the venue's Distance (mi) field supplies the one-way miles)
alter table venues add column if not exists auto_mileage boolean not null default false;

-- expense rows created by the engine are flagged so they're only created once
alter table expenses add column if not exists is_auto_mileage boolean not null default false;
-- DJEP expense options include a payment method per expense
alter table expenses add column if not exists payment_method text;

-- ============ AUTO MILEAGE ENGINE ============
-- Fires when an event is created or its status/venue changes: once the event's status
-- is in the Booked group and the venue has auto_mileage + a distance, insert the expense.
create or replace function apply_auto_mileage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  es expense_settings%rowtype;
  v venues%rowtype;
  booked boolean;
  miles numeric;
  amt numeric;
begin
  select * into es from expense_settings where id = true;
  if es is null or not es.auto_mileage_enabled then return new; end if;
  if new.venue_id is null or new.status_id is null then return new; end if;

  select coalesce(is_booked_group, false) into booked from event_statuses where id = new.status_id;
  if not coalesce(booked, false) then return new; end if;

  select * into v from venues where id = new.venue_id;
  if v is null or not coalesce(v.auto_mileage, false) or coalesce(v.distance_miles, 0) <= 0 then
    return new;
  end if;

  if exists (select 1 from expenses where event_id = new.id and is_auto_mileage) then
    return new;
  end if;

  miles := v.distance_miles * (case when es.mileage_round_trip then 2 else 1 end);
  amt := round(miles * es.mileage_rate, 2);

  insert into expenses (event_id, category_id, payee, description, amount, expense_date, is_auto_mileage)
  values (
    new.id,
    es.mileage_category_id,
    'Mileage',
    format('Auto mileage — %s (%s mi @ $%s/mi)', v.name, miles, es.mileage_rate),
    amt,
    coalesce(new.event_date, current_date),
    true
  );
  return new;
end;
$$;

drop trigger if exists events_auto_mileage on events;
create trigger events_auto_mileage
  after insert or update of status_id, venue_id on events
  for each row execute function apply_auto_mileage();

-- Backfill: apply to ALREADY-booked events at auto-mileage venues (run from settings page).
create or replace function run_auto_mileage()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  es expense_settings%rowtype;
  created int := 0;
begin
  select * into es from expense_settings where id = true;
  if es is null or not es.auto_mileage_enabled then return 0; end if;

  with inserted as (
    insert into expenses (event_id, category_id, payee, description, amount, expense_date, is_auto_mileage)
    select
      e.id,
      es.mileage_category_id,
      'Mileage',
      format('Auto mileage — %s (%s mi @ $%s/mi)',
             v.name,
             v.distance_miles * (case when es.mileage_round_trip then 2 else 1 end),
             es.mileage_rate),
      round(v.distance_miles * (case when es.mileage_round_trip then 2 else 1 end) * es.mileage_rate, 2),
      coalesce(e.event_date, current_date),
      true
    from events e
    join venues v on v.id = e.venue_id
    join event_statuses s on s.id = e.status_id
    where s.is_booked_group
      and v.auto_mileage
      and coalesce(v.distance_miles, 0) > 0
      and not exists (select 1 from expenses x where x.event_id = e.id and x.is_auto_mileage)
    returning 1
  )
  select count(*) into created from inserted;
  return created;
end;
$$;
