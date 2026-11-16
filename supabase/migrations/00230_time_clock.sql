-- XOS time clock: punch ledger with GPS, timesheet approval/lock, settings,
-- legacy check-in sync, backfill, query view, and field-staff RLS.
-- Safe to re-run (IF NOT EXISTS / drop-create view/functions).

-- ───────────────────── 1. settings (every rule editable) ─────────────────────
create table if not exists public.time_clock_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  -- location
  allow_punch_without_location boolean not null default true,
  capture_distance boolean not null default true,
  -- geofence (default off; editable later)
  geofence_enabled boolean not null default false,
  geofence_radius_m int not null default 500 check (geofence_radius_m > 0),
  geofence_mode text not null default 'off' check (geofence_mode in ('off', 'warn', 'block')),
  -- pay rules (defaults match owner choices; all toggles stay editable)
  include_travel_for_hourly_punches boolean not null default false,
  apply_rounding boolean not null default false,
  rounding_minutes int not null default 15 check (rounding_minutes in (1, 5, 6, 10, 15, 30)),
  apply_overtime boolean not null default false,
  overtime_weekly_hours numeric(5,2) not null default 40,
  overtime_multiplier numeric(4,2) not null default 1.5,
  apply_min_hours boolean not null default false,
  min_hours numeric(5,2) not null default 0,
  enable_breaks boolean not null default false,
  -- payroll / admin
  require_approval_before_payroll boolean not null default true,
  admin_edit_requires_reason boolean not null default true,
  missed_punch_grace_minutes int not null default 30 check (missed_punch_grace_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.time_clock_settings (id) values (true) on conflict (id) do nothing;

alter table public.time_clock_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on public.time_clock_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ───────────────────── 2. event_staff extensions ─────────────────────
alter table public.event_staff
  add column if not exists hourly_rate_override numeric(10,2);

alter table public.event_staff
  add column if not exists timesheet_status text not null default 'open';

do $$ begin
  alter table public.event_staff
    add constraint event_staff_timesheet_status_chk
    check (timesheet_status in ('open', 'submitted', 'approved', 'locked', 'paid'));
exception when duplicate_object then null; end $$;

alter table public.event_staff add column if not exists timesheet_hours numeric(10,4);
alter table public.event_staff add column if not exists timesheet_amount numeric(10,2);
alter table public.event_staff add column if not exists timesheet_rate numeric(10,2);
alter table public.event_staff add column if not exists timesheet_approved_by uuid references public.employees(id) on delete set null;
alter table public.event_staff add column if not exists timesheet_approved_at timestamptz;
alter table public.event_staff add column if not exists timesheet_locked_at timestamptz;
alter table public.event_staff add column if not exists timesheet_payable_id uuid references public.payroll_payables(id) on delete set null;
alter table public.event_staff add column if not exists location_missing boolean not null default false;

-- ───────────────────── 3. punches + audit ─────────────────────
create table if not exists public.time_punches (
  id uuid primary key default gen_random_uuid(),
  event_staff_id uuid not null references public.event_staff(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  event_id uuid not null references public.events(id) on delete cascade,
  punch_type text not null check (punch_type in ('in', 'out')),
  punched_at timestamptz not null,
  lat numeric(9,6),
  lng numeric(9,6),
  accuracy_m numeric(10,2),
  venue_lat numeric(9,6),
  venue_lng numeric(9,6),
  distance_m numeric(12,2),
  location_missing boolean not null default false,
  source text not null default 'self' check (source in ('self', 'admin', 'backfill')),
  note text,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists time_punches_event_staff_idx
  on public.time_punches (event_staff_id, punched_at)
  where deleted_at is null;
create index if not exists time_punches_employee_idx
  on public.time_punches (employee_id, punched_at)
  where deleted_at is null;
create index if not exists time_punches_event_idx
  on public.time_punches (event_id, punched_at)
  where deleted_at is null;

create table if not exists public.time_punch_edits (
  id uuid primary key default gen_random_uuid(),
  punch_id uuid,
  event_staff_id uuid not null references public.event_staff(id) on delete cascade,
  action text not null check (action in ('insert', 'update', 'delete')),
  before_row jsonb,
  after_row jsonb,
  reason text not null,
  edited_by uuid not null references public.employees(id),
  created_at timestamptz not null default now()
);
create index if not exists time_punch_edits_staff_idx
  on public.time_punch_edits (event_staff_id, created_at desc);

alter table public.time_punches enable row level security;
alter table public.time_punch_edits enable row level security;
do $$ begin
  create policy "authenticated full access" on public.time_punches
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.time_punch_edits
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ───────────────────── 4. hours helper + sync legacy stamps ─────────────────────
create or replace function public.xos_punch_hours(p_event_staff_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  open_at timestamptz := null;
  total_ms numeric := 0;
begin
  for r in
    select punch_type, punched_at
    from public.time_punches
    where event_staff_id = p_event_staff_id and deleted_at is null
    order by punched_at asc, created_at asc
  loop
    if r.punch_type = 'in' then
      if open_at is null then open_at := r.punched_at; end if;
    elsif r.punch_type = 'out' and open_at is not null then
      total_ms := total_ms + extract(epoch from (r.punched_at - open_at)) * 1000;
      open_at := null;
    end if;
  end loop;
  return round((greatest(total_ms, 0) / 3600000.0)::numeric, 4);
end;
$$;
revoke all on function public.xos_punch_hours(uuid) from public, anon;
grant execute on function public.xos_punch_hours(uuid) to authenticated, service_role;

create or replace function public.xos_sync_event_staff_from_punches(p_event_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  first_in timestamptz;
  last_out timestamptz;
  any_missing boolean;
begin
  perform set_config('xos.syncing_punches', '1', true);

  select min(punched_at) filter (where punch_type = 'in'),
         max(punched_at) filter (where punch_type = 'out'),
         coalesce(bool_or(location_missing), false)
    into first_in, last_out, any_missing
  from public.time_punches
  where event_staff_id = p_event_staff_id and deleted_at is null;

  update public.event_staff es
  set checked_in_at = first_in,
      checked_out_at = last_out,
      location_missing = any_missing,
      timesheet_hours = case
        when es.timesheet_status in ('approved', 'locked', 'paid') then es.timesheet_hours
        else public.xos_punch_hours(p_event_staff_id)
      end
  where es.id = p_event_staff_id;
end;
$$;
revoke all on function public.xos_sync_event_staff_from_punches(uuid) from public, anon, authenticated;

create or replace function public.xos_time_punches_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.xos_sync_event_staff_from_punches(coalesce(new.event_staff_id, old.event_staff_id));
  return coalesce(new, old);
end;
$$;
revoke all on function public.xos_time_punches_after_change() from public, anon, authenticated;

drop trigger if exists time_punches_sync_staff on public.time_punches;
create trigger time_punches_sync_staff
  after insert or update or delete on public.time_punches
  for each row execute function public.xos_time_punches_after_change();

-- Allow sync to update timesheet/location columns on event_staff for field staff.
create or replace function public.xos_event_staff_field_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'notified_at', 'confirmed_at', 'declined_at', 'checked_in_at', 'checked_out_at',
    'location_missing', 'timesheet_hours'
  ];
begin
  if current_setting('xos.syncing_punches', true) = '1' then
    return coalesce(new, old);
  end if;
  if auth.uid() is null or not public.xos_is_field_staff() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'field staff cannot % event staff assignments', lower(tg_op) using errcode = '42501';
  end if;
  if old.employee_id is distinct from public.xos_current_employee_id() then
    raise exception 'field staff can only update their own assignment' using errcode = '42501';
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'field staff can only update check-in/confirmation fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ───────────────────── 5. backfill legacy stamps into punches ─────────────────────
insert into public.time_punches (
  event_staff_id, employee_id, event_id, punch_type, punched_at,
  location_missing, source, note
)
select es.id, es.employee_id, es.event_id, 'in', es.checked_in_at,
       true, 'backfill', 'Backfilled from checked_in_at'
from public.event_staff es
where es.checked_in_at is not null
  and not exists (
    select 1 from public.time_punches tp
    where tp.event_staff_id = es.id and tp.source = 'backfill' and tp.punch_type = 'in'
  );

insert into public.time_punches (
  event_staff_id, employee_id, event_id, punch_type, punched_at,
  location_missing, source, note
)
select es.id, es.employee_id, es.event_id, 'out', es.checked_out_at,
       true, 'backfill', 'Backfilled from checked_out_at'
from public.event_staff es
where es.checked_out_at is not null
  and not exists (
    select 1 from public.time_punches tp
    where tp.event_staff_id = es.id and tp.source = 'backfill' and tp.punch_type = 'out'
  );

-- ───────────────────── 6. query view for agents / bookkeeping ─────────────────────
create or replace function public.xos_effective_hourly_rate(p_event_staff_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    es.hourly_rate_override,
    es.timesheet_rate,
    em.hourly_rate,
    0
  )
  from public.event_staff es
  left join public.employees em on em.id = es.employee_id
  where es.id = p_event_staff_id;
$$;
revoke all on function public.xos_effective_hourly_rate(uuid) from public, anon;
grant execute on function public.xos_effective_hourly_rate(uuid) to authenticated, service_role;

drop view if exists public.v_event_staff_time_pay;
create view public.v_event_staff_time_pay
with (security_invoker = true)
as
select
  es.id as event_staff_id,
  es.event_id,
  es.employee_id,
  es.role,
  es.pay_type,
  case
    when es.pay_type = 'hourly' then public.xos_effective_hourly_rate(es.id)
    else null
  end as rate,
  (select count(*)::int from public.time_punches tp
    where tp.event_staff_id = es.id and tp.deleted_at is null) as punch_count,
  (select min(tp.punched_at) from public.time_punches tp
    where tp.event_staff_id = es.id and tp.deleted_at is null and tp.punch_type = 'in') as first_in,
  (select max(tp.punched_at) from public.time_punches tp
    where tp.event_staff_id = es.id and tp.deleted_at is null and tp.punch_type = 'out') as last_out,
  coalesce(es.timesheet_hours, public.xos_punch_hours(es.id)) as hours_worked,
  case
    when es.pay_type = 'flat' then coalesce(es.flat_wage, 0)
    when es.timesheet_amount is not null then es.timesheet_amount
    else round(coalesce(es.timesheet_hours, public.xos_punch_hours(es.id))
               * public.xos_effective_hourly_rate(es.id), 2)
  end as amount,
  es.timesheet_status as approval_status,
  coalesce(es.location_missing, false)
    or exists (
      select 1 from public.time_punches tp
      where tp.event_staff_id = es.id and tp.deleted_at is null and tp.location_missing
    ) as location_missing,
  es.timesheet_payable_id as payable_id
from public.event_staff es;

grant select on public.v_event_staff_time_pay to authenticated, service_role;

-- ───────────────────── 7. field-staff views: expose pay_type + own rate ─────────────────────
drop view if exists public.xos_fs_event_staff;
create view public.xos_fs_event_staff with (security_invoker = false, security_barrier = true) as
select
  es.id, es.event_id, es.employee_id, es.role, es.pay_type,
  em.first_name, em.last_name, em.stage_name,
  es.start_time, es.end_time, es.notes, es.portal_visible,
  es.notified_at, es.confirmed_at, es.declined_at, es.checked_in_at, es.checked_out_at,
  es.timesheet_status, es.timesheet_hours, es.location_missing,
  case
    when public.xos_sees_all_events() or es.employee_id = public.xos_current_employee_id()
      then es.flat_wage
  end as flat_wage,
  case
    when public.xos_sees_all_events() or es.employee_id = public.xos_current_employee_id()
      then es.hourly_rate_override
  end as hourly_rate_override
from public.event_staff es
left join public.employees em on em.id = es.employee_id
where public.xos_is_staff()
  and (public.xos_sees_all_events() or public.xos_is_assigned(es.event_id));

revoke all on public.xos_fs_event_staff from public, anon, authenticated;
grant select on public.xos_fs_event_staff to authenticated, service_role;

-- ───────────────────── 8. field-staff restrictive RLS ─────────────────────
drop policy if exists "field staff scope" on public.time_clock_settings;
create policy "field staff scope" on public.time_clock_settings as restrictive for all to authenticated
  using (xos_sees_all_events() or true)  -- staff may read settings; writes gated in app
  with check (xos_sees_all_events());

drop policy if exists "field staff scope" on public.time_punches;
create policy "field staff scope" on public.time_punches as restrictive for all to authenticated
  using (
    xos_sees_all_events()
    or employee_id = xos_current_employee_id()
  )
  with check (
    xos_sees_all_events()
    or (
      employee_id = xos_current_employee_id()
      and exists (
        select 1 from public.event_staff es
        where es.id = event_staff_id and es.employee_id = xos_current_employee_id()
      )
    )
  );

drop policy if exists "field staff scope" on public.time_punch_edits;
create policy "field staff scope" on public.time_punch_edits as restrictive for all to authenticated
  using (
    xos_sees_all_events()
    or exists (
      select 1 from public.event_staff es
      where es.id = event_staff_id and es.employee_id = xos_current_employee_id()
    )
  )
  with check (xos_sees_all_events());  -- only office writes audit via admin actions

-- Deny field staff money tables still includes payroll; punches are separate.
-- Ensure 00218 money denylist note: time_clock_settings is not money.

comment on table public.time_punches is 'Staff clock in/out punches with optional GPS; location kept with payroll.';
comment on table public.time_punch_edits is 'Admin insert/update/delete audit for time_punches (reason required).';
comment on table public.time_clock_settings is 'Singleton time-clock rules; every pay/GPS rule is editable in Settings.';
comment on view public.v_event_staff_time_pay is 'Queryable hours and pay per event_staff for bookkeeping agents.';
