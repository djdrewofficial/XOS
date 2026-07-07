-- Backfill the email_templates.sched_vendor_category_ids column.
-- It was defined in 00025_email_recipients.sql but never landed on the live DB
-- (early migration history was squashed), so template saves failed with
-- "Could not find the 'sched_vendor_category_ids' column in the schema cache".
-- Additive and idempotent; existing rows get the default empty array.
alter table email_templates
  add column if not exists sched_vendor_category_ids uuid[] not null default '{}';
