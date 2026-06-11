-- XOS — Booking tab enhancements: event numbers, booked date, custom date fields,
-- note authors, contract notes, and a trigger-driven event audit log.

-- ============ EVENT NUMBER (human-friendly ID; imports keep their DJEP ids) ============
create sequence if not exists event_number_seq start with 500000;
alter table events add column if not exists event_number bigint;
update events set event_number = nextval('event_number_seq') where event_number is null;
alter table events alter column event_number set default nextval('event_number_seq');
alter table events add constraint events_event_number_key unique (event_number);

-- ============ DATE BOOKED ============
alter table events add column if not exists booked_date date;

-- ============ NOTE AUTHORS + CONTRACT NOTES ============
alter table event_notes add column if not exists author_name text;
alter table event_notes add column if not exists kind text not null default 'internal';
alter table event_notes add constraint event_notes_kind_check check (kind in ('internal','contract'));
alter table client_notes add column if not exists author_name text;

-- ============ CUSTOM DATE FIELDS (defined in settings, valued per event) ============
create table custom_date_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table event_custom_dates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  definition_id uuid not null references custom_date_definitions(id) on delete cascade,
  value date,
  unique (event_id, definition_id)
);

insert into custom_date_definitions (name, sort_order) values
  ('Contract Signed', 1),
  ('Quote Sent', 2),
  ('Date Status Changed', 3);

-- migrate values that used to live in dedicated columns
insert into event_custom_dates (event_id, definition_id, value)
select e.id, d.id, e.contract_signed_date
from events e cross join custom_date_definitions d
where d.name = 'Contract Signed' and e.contract_signed_date is not null;

insert into event_custom_dates (event_id, definition_id, value)
select e.id, d.id, e.quote_sent_date
from events e cross join custom_date_definitions d
where d.name = 'Quote Sent' and e.quote_sent_date is not null;

-- ============ EVENT AUDIT LOG ============
create table event_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  actor text not null default 'system',
  action text not null,
  created_at timestamptz not null default now()
);
create index event_logs_event_idx on event_logs(event_id, created_at desc);

alter table custom_date_definitions enable row level security;
alter table event_custom_dates enable row level security;
alter table event_logs enable row level security;
create policy "authenticated full access" on custom_date_definitions for all to authenticated using (true) with check (true);
create policy "authenticated full access" on event_custom_dates for all to authenticated using (true) with check (true);
create policy "authenticated full access" on event_logs for all to authenticated using (true) with check (true);

-- who is performing the current request (employee name → auth email → 'system')
create or replace function current_actor()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select nullif(trim(first_name || ' ' || last_name), '') from employees where auth_user_id = auth.uid()),
    (select email from auth.users where id = auth.uid()),
    'system'
  )
$$;

-- ============ TRIGGER: log changes on events ============
create or replace function log_event_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_booked boolean;
  v_def uuid;
begin
  if tg_op = 'INSERT' then
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Event created');
    return new;
  end if;

  if old.status_id is distinct from new.status_id then
    select name, is_booked_group into v_name, v_booked from event_statuses where id = new.status_id;
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Status changed to ' || coalesce(v_name, '(none)'));

    select id into v_def from custom_date_definitions where name = 'Date Status Changed';
    if v_def is not null then
      insert into event_custom_dates (event_id, definition_id, value)
      values (new.id, v_def, current_date)
      on conflict (event_id, definition_id) do update set value = excluded.value;
    end if;

    if coalesce(v_booked, false) and new.booked_date is null then
      new.booked_date := current_date;
      insert into event_logs (event_id, actor, action)
      values (new.id, current_actor(), 'Date Booked set to ' || current_date::text);
    end if;
  end if;

  if old.event_date is distinct from new.event_date then
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Event date changed: ' || coalesce(old.event_date::text, '—') || ' → ' || coalesce(new.event_date::text, '—'));
  end if;
  if old.start_time is distinct from new.start_time or old.end_time is distinct from new.end_time or old.setup_time is distinct from new.setup_time then
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Times changed: setup ' || coalesce(new.setup_time::text, '—') || ', start ' || coalesce(new.start_time::text, '—') || ', end ' || coalesce(new.end_time::text, '—'));
  end if;
  if old.venue_id is distinct from new.venue_id then
    select name into v_name from venues where id = new.venue_id;
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Venue changed to ' || coalesce(v_name, '(none)'));
  end if;
  if old.package_id is distinct from new.package_id then
    select name into v_name from packages where id = new.package_id;
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Package changed to ' || coalesce(v_name, '(none)'));
  end if;
  if old.name is distinct from new.name then
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Event name changed to "' || coalesce(new.name, '') || '"');
  end if;
  if old.inquiry_source_id is distinct from new.inquiry_source_id then
    select name into v_name from inquiry_sources where id = new.inquiry_source_id;
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Inquiry source set to ' || coalesce(v_name, '(none)'));
  end if;
  if old.contract_sent_date is distinct from new.contract_sent_date then
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Contract Sent date set to ' || coalesce(new.contract_sent_date::text, '—'));
  end if;
  if old.contract_due_date is distinct from new.contract_due_date then
    insert into event_logs (event_id, actor, action)
    values (new.id, current_actor(), 'Contract Due date set to ' || coalesce(new.contract_due_date::text, '—'));
  end if;

  return new;
end;
$$;

create trigger events_log_update before update on events
  for each row execute function log_event_changes();
create trigger events_log_insert after insert on events
  for each row execute function log_event_changes();

-- ============ TRIGGER: log client add/remove ============
create or replace function log_event_client_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select trim(first_name || ' ' || last_name) into v_name from clients where id = new.client_id;
    insert into event_logs (event_id, actor, action)
    values (new.event_id, current_actor(), 'Client added: ' || coalesce(v_name, '?') || ' (' || new.role || ')');
    return new;
  else
    select trim(first_name || ' ' || last_name) into v_name from clients where id = old.client_id;
    insert into event_logs (event_id, actor, action)
    values (old.event_id, current_actor(), 'Client removed: ' || coalesce(v_name, '?'));
    return old;
  end if;
end;
$$;

create trigger event_clients_log after insert or delete on event_clients
  for each row execute function log_event_client_changes();

-- ============ TRIGGER: log staff add/remove ============
create or replace function log_event_staff_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select trim(first_name || ' ' || last_name) into v_name from employees where id = new.employee_id;
    insert into event_logs (event_id, actor, action)
    values (new.event_id, current_actor(), 'Staff assigned: ' || coalesce(v_name, '?') || ' (' || new.role || ')');
    return new;
  else
    select trim(first_name || ' ' || last_name) into v_name from employees where id = old.employee_id;
    insert into event_logs (event_id, actor, action)
    values (old.event_id, current_actor(), 'Staff removed: ' || coalesce(v_name, '?'));
    return old;
  end if;
end;
$$;

create trigger event_staff_log after insert or delete on event_staff
  for each row execute function log_event_staff_changes();

-- ============ TRIGGER: log payments ============
create or replace function log_payment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.event_id is not null then
      insert into event_logs (event_id, actor, action)
      values (new.event_id, current_actor(), 'Payment recorded: ' || to_char(new.amount, 'FM$999,999,990.00') || ' (' || new.method || ')');
    end if;
    return new;
  else
    if old.event_id is not null then
      insert into event_logs (event_id, actor, action)
      values (old.event_id, current_actor(), 'Payment deleted: ' || to_char(old.amount, 'FM$999,999,990.00'));
    end if;
    return old;
  end if;
end;
$$;

create trigger payments_log after insert or delete on payments
  for each row execute function log_payment_changes();

-- ============ TRIGGER: log booking helper runs ============
create or replace function log_helper_runs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_title text;
begin
  select title into v_title from booking_helpers where id = new.helper_id;
  insert into event_logs (event_id, actor, action)
  values (new.event_id, current_actor(), 'Booking helper run: ' || coalesce(v_title, '?'));
  return new;
end;
$$;

create trigger booking_helper_runs_log after insert on booking_helper_runs
  for each row execute function log_helper_runs();
