-- Marketing role: works the Vendors directory, sees NO financial information.
-- Screen access is the normal role grid (Settings → Permissions, editable later);
-- the money tables are additionally blocked at the database level so a Marketing
-- login can't read them through the API either.

-- 1) allow the new tier everywhere tiers are constrained
alter table public.employees drop constraint if exists employees_permission_tier_check;
alter table public.employees add constraint employees_permission_tier_check
  check (permission_tier = any (array['master_admin','admin','salesperson','employee','marketing']));

alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role = any (array['master_admin','admin','salesperson','employee','marketing']));

alter table public.role_settings drop constraint if exists role_settings_role_check;
alter table public.role_settings add constraint role_settings_role_check
  check (role = any (array['master_admin','admin','salesperson','employee','marketing']));

alter table public.dashboard_layouts drop constraint if exists dashboard_layouts_role_check;
alter table public.dashboard_layouts add constraint dashboard_layouts_role_check
  check (role = any (array['master_admin','admin','salesperson','employee','marketing']));

-- 2) default screen access: Vendors (edit) only; lands on /vendors
insert into public.role_permissions (role, module, access)
select 'marketing', m, case when m = 'vendors' then 'edit' else 'none' end
from unnest(array['dashboard','inbox','events','clients','documents','tasks','venues','vendors','packages',
                  'equipment','employees','payments','commissions','payroll','reports','settings','gallery']) as m
on conflict (role, module) do nothing;

insert into public.role_settings (role, landing_page) values ('marketing', '/vendors')
on conflict (role) do nothing;

-- 3) hard block: Marketing never reads/writes money tables (RESTRICTIVE = ANDed
--    with the existing policies; other staff and client portal access unchanged)
do $$
declare t text;
begin
  foreach t in array array['payments','scheduled_payments','expenses','expense_settings','payroll_payables',
                           'payroll_payments','payroll_settings','payment_settings','payment_reminder_rules',
                           'payment_reminder_sends','event_trips']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "no marketing access" on public.%I', t);
      execute format(
        'create policy "no marketing access" on public.%I as restrictive for all to authenticated
           using (xos_current_tier() is distinct from ''marketing'')
           with check (xos_current_tier() is distinct from ''marketing'')', t);
    end if;
  end loop;
end $$;
