-- XOS — payroll subsystem: per-venue travel time, pay cadence + paydays,
-- payables ledger (auto staff cost + manual vendor/contractor), payments
-- (full/partial), and staff timesheet correction requests.

-- one-way drive time to a venue (minutes); used to estimate payable hours
alter table venues add column if not exists travel_minutes int;

-- payroll cadence (singleton row, id=true — same pattern as payment_settings)
create table if not exists payroll_settings (
  id boolean primary key default true,
  frequency text not null default 'biweekly' check (frequency in ('weekly','biweekly','monthly')),
  anchor_payday date,                 -- the "first pay day"; future paydays derive from this
  created_at timestamptz not null default now()
);
insert into payroll_settings (id) values (true) on conflict (id) do nothing;

-- staff-requested corrections to their recorded check-in/out times
create table if not exists timesheet_change_requests (
  id uuid primary key default gen_random_uuid(),
  event_staff_id uuid not null references event_staff(id) on delete cascade,
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists tcr_pending_idx on timesheet_change_requests(status, created_at desc);

-- what we owe for a pay period (auto = computed staff cost, manual = vendor/contractor/ad-hoc)
create table if not exists payroll_payables (
  id uuid primary key default gen_random_uuid(),
  pay_period date not null,           -- the payday this belongs to
  payee_kind text not null check (payee_kind in ('employee','vendor','contractor')),
  employee_id uuid references employees(id) on delete set null,
  vendor_id uuid references vendors(id) on delete set null,
  payee_name text,
  event_id uuid references events(id) on delete set null,
  description text,
  amount_owed numeric(10,2) not null default 0,
  source text not null default 'manual' check (source in ('auto','manual')),
  created_at timestamptz not null default now()
);
-- idempotent auto-generation: one auto payable per staffer per event per payday
create unique index if not exists payroll_payables_auto_idx
  on payroll_payables(pay_period, employee_id, event_id) where source = 'auto';
create index if not exists payroll_payables_period_idx on payroll_payables(pay_period);

-- payments made against a payable (supports partial: many payments per payable)
create table if not exists payroll_payments (
  id uuid primary key default gen_random_uuid(),
  payable_id uuid not null references payroll_payables(id) on delete cascade,
  amount numeric(10,2) not null,
  method text,
  notes text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists payroll_payments_payable_idx on payroll_payments(payable_id);

-- RLS: authenticated full access (matches every other table)
alter table payroll_settings enable row level security;
alter table timesheet_change_requests enable row level security;
alter table payroll_payables enable row level security;
alter table payroll_payments enable row level security;
do $$ begin
  create policy "authenticated full access" on payroll_settings for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on timesheet_change_requests for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on payroll_payables for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on payroll_payments for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
