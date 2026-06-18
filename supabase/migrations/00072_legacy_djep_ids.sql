-- XOS — legacy DJEP id links for the data migration (clients, employees, and the
-- catalog), so imported events can resolve their package/add-on/client/employee
-- references back to XOS rows. Multiple NULLs allowed; non-null must be unique.
alter table clients   add column if not exists legacy_djep_id text;
alter table employees add column if not exists legacy_djep_id text;
alter table packages  add column if not exists legacy_djep_id text;
alter table addons    add column if not exists legacy_djep_id text;

do $$ begin alter table clients   add constraint clients_legacy_djep_key   unique (legacy_djep_id); exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin alter table employees add constraint employees_legacy_djep_key unique (legacy_djep_id); exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin alter table packages  add constraint packages_legacy_djep_key  unique (legacy_djep_id); exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin alter table addons    add constraint addons_legacy_djep_key    unique (legacy_djep_id); exception when duplicate_object then null; when duplicate_table then null; end $$;
