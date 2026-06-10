-- XOS Beta 1 — initial schema
-- Core entities per DJEP-Replacement-Spec.md §3

-- ============ STATUS SYSTEM (§4) ============
create table event_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#F0F0F0',
  text_color text not null default '#000000',
  is_active boolean not null default true,
  -- semantic groups drive financials, availability, and reporting
  is_booked_group boolean not null default false,
  is_pending_group boolean not null default false,
  is_lost_sale_group boolean not null default false,
  is_leads_group boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============ PEOPLE & PLACES ============
create table clients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  organization text,
  cell_phone text,
  email text,
  mailing_address text,
  anniversary date,
  notes text,
  sms_opt_in boolean not null default false,
  sms_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  travel_fee numeric(10,2) not null default 0,
  setup_fee numeric(10,2) not null default 0,
  distance_miles numeric(6,1),
  load_in_details text,
  driving_notes text,
  notes text,
  category text,
  is_one_time boolean not null default false,
  external_links jsonb not null default '[]'::jsonb, -- e.g. Frame.io
  created_at timestamptz not null default now()
);

create table venue_rooms (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null
);

create table venue_contacts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  email text
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  category text,
  notes text,
  created_at timestamptz not null default now()
);

create table vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  email text
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- links to supabase auth.users
  first_name text not null,
  last_name text not null default '',
  email text,
  phone text,
  permission_tier text not null default 'employee'
    check (permission_tier in ('master_admin','admin','salesperson','employee')),
  hourly_rate numeric(10,2),
  addon_commission_pct numeric(5,2) not null default 0,
  sales_commission_pct numeric(5,2) not null default 0,
  check_in_required boolean not null default false,
  emergency_contact text,
  birthday date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table employee_time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  notes text,
  created_at timestamptz not null default now()
);

-- ============ CATALOG ============
create table package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);

create table packages (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references package_categories(id),
  name text not null,
  default_price numeric(10,2) not null default 0,
  included_hours numeric(4,1) not null default 0, -- 0 = untimed
  overtime_hourly numeric(10,2) not null default 0,
  overtime_half_hourly numeric(10,2) not null default 0,
  hourly_rate numeric(10,2) not null default 0, -- for hourly-only packages
  is_hourly boolean not null default false,
  deposit_value numeric(10,2) not null default 0,
  is_taxable boolean not null default false,
  is_active boolean not null default true,
  display_order int not null default 0
);

create table addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  default_price numeric(10,2) not null default 0,
  commission_eligible boolean not null default true,
  is_active boolean not null default true,
  display_order int not null default 0
);

create table inquiry_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

create table event_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

-- ============ EVENTS (§5.2) ============
create table events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  event_type_id uuid references event_types(id),
  status_id uuid references event_statuses(id),
  inquiry_source_id uuid references inquiry_sources(id),
  salesperson_id uuid references employees(id),
  name text not null default '',
  event_date date,
  setup_time time,
  start_time time,
  end_time time,
  guest_count int,
  venue_id uuid references venues(id),
  venue_room_id uuid references venue_rooms(id),
  use_client_address boolean not null default false,
  -- financials
  package_id uuid references packages(id),
  package_price_override numeric(10,2), -- null = use package default
  overtime_hours numeric(4,1) not null default 0,
  overtime_fee numeric(10,2) not null default 0,
  travel_fee numeric(10,2) not null default 0,
  discount1_label text,
  discount1_amount numeric(10,2) not null default 0,
  discount2_label text,
  discount2_amount numeric(10,2) not null default 0,
  deposit_value numeric(10,2) not null default 0,
  -- important dates
  initial_contact_date date,
  contract_sent_date date,
  contract_due_date date,
  contract_signed_date date,
  quote_sent_date date,
  -- custom fields (jsonb keeps beta flexible; formalize later)
  custom_fields jsonb not null default '{}'::jsonb,
  -- e.g. {"gdrive_timeline":"...","gdrive_folder":"...","vibo_link":"...","photobooth_gallery":"..."}
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_date_idx on events(event_date);
create index events_status_idx on events(status_id);
create index events_client_idx on events(client_id);

create table event_addons (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  addon_id uuid not null references addons(id),
  quantity int not null default 1,
  price_override numeric(10,2) -- null = use addon default
);

create table event_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  employee_id uuid not null references employees(id),
  role text not null default 'DJ',
  pay_type text not null default 'flat' check (pay_type in ('flat','hourly')),
  flat_wage numeric(10,2) not null default 0,
  notified_at timestamptz,
  confirmed_at timestamptz,
  declined_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  paid_at timestamptz,
  portal_visible boolean not null default true,
  notes text
);

create table event_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  author_id uuid references employees(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ============ PAYMENTS (§5.6) ============
create table scheduled_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  seq int not null, -- 1 = deposit; unlimited count (DJEP capped at 3)
  due_date date,
  amount numeric(10,2) not null default 0,
  label text
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  scheduled_payment_id uuid references scheduled_payments(id) on delete set null,
  amount numeric(10,2) not null,
  method text not null default 'other'
    check (method in ('card','cash','check','zelle','venmo','ach','other')),
  paid_at timestamptz not null default now(),
  status text not null default 'approved' check (status in ('approved','pending')),
  sales_tax numeric(10,2) not null default 0,
  bank_deposit_ref text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============ AUTOMATION (§4 daily actions; §6 booking helpers — engine tables, beta 1 = status rollovers only) ============
create table daily_status_actions (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null default 'event_date_passed'
    check (trigger_type in ('event_date_passed','contract_due_passed')),
  from_status_id uuid not null references event_statuses(id),
  to_status_id uuid not null references event_statuses(id),
  is_active boolean not null default true
);

create table booking_helpers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  button_text text not null,
  button_bg text not null default '#97CC9A',
  button_fg text not null default '#000000',
  position int not null default 0,
  is_active boolean not null default true,
  -- visibility conditions
  visible_status_ids uuid[] not null default '{}', -- empty = all
  hide_if_payment_made boolean not null default false,
  hide_if_already_ran boolean not null default false,
  hide_if_helpers_ran uuid[] not null default '{}',
  -- actions (beta 1: declarative json; executor interprets)
  actions jsonb not null default '[]'::jsonb,
  -- e.g. [{"type":"set_status","status_id":"..."},{"type":"send_email","template_id":"...","to":"client"}]
  created_at timestamptz not null default now()
);

create table booking_helper_runs (
  id uuid primary key default gen_random_uuid(),
  helper_id uuid not null references booking_helpers(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  run_by uuid references employees(id),
  run_at timestamptz not null default now()
);

-- ============ EMAIL TEMPLATES (§5.9 — beta 1 stores templates; sending wired to Mailgun in beta 2) ============
create table email_templates (
  id uuid primary key default gen_random_uuid(),
  group_name text not null default 'GENERAL',
  name text not null,
  subject text not null default '',
  body_html text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  template_id uuid references email_templates(id),
  to_address text not null,
  subject text not null,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ updated_at triggers ============
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger events_updated_at before update on events
  for each row execute function set_updated_at();
create trigger clients_updated_at before update on clients
  for each row execute function set_updated_at();

-- ============ RLS: authenticated users only (beta 1 = trusted internal team) ============
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "authenticated full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
