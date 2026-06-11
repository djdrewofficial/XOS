-- XOS — payment schedule rules live on the package and drive schedule generation
-- (and later, the client's schedule choice in the booking-agreement workflow).

alter table packages add column if not exists allowed_splits int[] not null default '{1,2,3}';
-- 'days_before'   => balance must be paid N days BEFORE the event date
-- 'net_days_after' => corporate Net-N terms: balance due N days AFTER the event date
alter table packages add column if not exists payment_terms text not null default 'days_before';
alter table packages add constraint packages_payment_terms_check
  check (payment_terms in ('days_before', 'net_days_after'));
alter table packages add column if not exists payment_terms_days int not null default 30;
