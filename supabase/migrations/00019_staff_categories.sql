-- XOS — employee staff categories for directory grouping

alter table employees add column if not exists staff_category text not null default 'Production';

update employees set staff_category = 'Administrators' where permission_tier in ('master_admin', 'admin');
update employees set staff_category = 'Salespeople' where permission_tier = 'salesperson';

alter table employees add constraint employees_staff_category_check
  check (staff_category in ('Administrators', 'Salespeople', 'Production', 'Subcontractors', 'Live Musicians'));
