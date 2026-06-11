-- XOS — per-status membership in the Financials / Availability / Payroll sets
-- (DJEP's "Financials/Employee Availability/Payroll Event Status Options").
-- Each is independent: which statuses count toward financial calcs, block employee
-- availability, and generate employee payroll.

alter table event_statuses add column if not exists counts_financial boolean not null default false;
alter table event_statuses add column if not exists counts_availability boolean not null default false;
alter table event_statuses add column if not exists counts_payroll boolean not null default false;

-- seed from the existing Booked group (booked events count toward all three);
-- guarded so re-running won't overwrite any you've since customized
update event_statuses set
  counts_financial = is_booked_group,
  counts_availability = is_booked_group,
  counts_payroll = is_booked_group
where counts_financial = false and counts_availability = false and counts_payroll = false;
