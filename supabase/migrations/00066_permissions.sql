-- XOS — editable RBAC over the app's screens (Settings → Application → Permissions).
-- Three layers resolve to an effective access level per screen ("module"):
--   employee override  >  role default  >  hardcoded fallback (src/lib/permissions.ts)
-- Master Admin is always full access in code and is never reduced here.
-- Access levels: 'none' (hidden + route blocked) | 'view' (read-only) | 'edit' (read+write).

-- Per-role defaults: one row per (role, module).
create table if not exists role_permissions (
  role text not null
    check (role in ('master_admin', 'admin', 'salesperson', 'employee')),
  module text not null,
  access text not null default 'none'
    check (access in ('none', 'view', 'edit')),
  updated_at timestamptz not null default now(),
  primary key (role, module)
);

-- Per-user overrides: presence of a row overrides the role default for that module.
create table if not exists employee_permissions (
  employee_id uuid not null references employees(id) on delete cascade,
  module text not null,
  access text not null
    check (access in ('none', 'view', 'edit')),
  updated_at timestamptz not null default now(),
  primary key (employee_id, module)
);

-- Per-role landing page (screen shown right after login). Per-user override lives
-- on employees.landing_page (null = fall back to the role default).
create table if not exists role_settings (
  role text primary key
    check (role in ('master_admin', 'admin', 'salesperson', 'employee')),
  landing_page text,
  updated_at timestamptz not null default now()
);

alter table employees add column if not exists landing_page text;

-- RLS: authenticated full access, matching the rest of XOS.
alter table role_permissions enable row level security;
alter table employee_permissions enable row level security;
alter table role_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on role_permissions
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on employee_permissions
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on role_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Seed sensible role defaults (Drew can change them all in the UI).
-- master_admin/admin: edit everything. salesperson: sales-focused. employee: minimal.
insert into role_permissions (role, module, access) values
  -- admin — full edit on every screen
  ('admin','dashboard','edit'),('admin','inbox','edit'),('admin','events','edit'),
  ('admin','clients','edit'),('admin','documents','edit'),('admin','venues','edit'),
  ('admin','vendors','edit'),('admin','packages','edit'),('admin','equipment','edit'),
  ('admin','employees','edit'),('admin','payments','edit'),('admin','commissions','edit'),
  ('admin','payroll','edit'),('admin','reports','edit'),('admin','settings','edit'),
  -- salesperson
  ('salesperson','dashboard','edit'),('salesperson','inbox','edit'),('salesperson','events','edit'),
  ('salesperson','clients','edit'),('salesperson','documents','edit'),('salesperson','venues','view'),
  ('salesperson','vendors','view'),('salesperson','packages','view'),('salesperson','equipment','view'),
  ('salesperson','employees','view'),('salesperson','payments','view'),('salesperson','commissions','view'),
  ('salesperson','payroll','none'),('salesperson','reports','view'),('salesperson','settings','none'),
  -- employee
  ('employee','dashboard','view'),('employee','inbox','view'),('employee','events','view'),
  ('employee','clients','none'),('employee','documents','none'),('employee','venues','view'),
  ('employee','vendors','none'),('employee','packages','none'),('employee','equipment','view'),
  ('employee','employees','none'),('employee','payments','none'),('employee','commissions','none'),
  ('employee','payroll','none'),('employee','reports','none'),('employee','settings','none')
on conflict (role, module) do nothing;

insert into role_settings (role, landing_page) values
  ('master_admin', '/'), ('admin', '/'), ('salesperson', '/events'), ('employee', '/')
on conflict (role) do nothing;
