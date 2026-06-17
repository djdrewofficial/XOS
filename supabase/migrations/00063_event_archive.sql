-- XOS — event archiving. Non-master_admin staff archive instead of deleting:
-- archived events keep their data but stop all automations and drop out of the
-- daily Events list / dashboard. archived_at null = active.
alter table events add column if not exists archived_at timestamptz;

-- the Events list / dashboard filter on "active" (archived_at is null)
create index if not exists events_active_idx on events(event_date) where archived_at is null;

-- archiving cancels any still-queued automated emails/SMS for the event, so add
-- a 'cancelled' terminal status to both outboxes.
alter table email_log drop constraint if exists email_log_status_check;
alter table email_log add constraint email_log_status_check
  check (status in ('queued','sent','delivered','opened','failed','bounced','complained','cancelled'));

alter table sms_log drop constraint if exists sms_log_status_check;
alter table sms_log add constraint sms_log_status_check
  check (status in ('queued','sent','failed','cancelled'));
