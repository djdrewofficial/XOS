-- XOS — Client Journey: configurable "signing requirements" (warn-only gate).
-- Office collects these fields BEFORE sending the quote; if any are missing the
-- event page / send flow WARNS (never blocks — Drew's call). Set a global default
-- here and optionally override per event type.

-- global default list of required field keys (see SIGNING_FIELDS in
-- src/lib/signingRequirements.ts for the catalog). text[] keeps it simple and
-- matches the rest of the settings tables (notif_types, payment_methods, …).
alter table journey_settings
  add column if not exists required_signing_fields text[] not null
  default array[
    'contract_holder','partner_a_name','partner_a_contact','partner_b_contact',
    'venue_name','venue_address','package','payment_schedule',
    'event_date','estimated_times'
  ]::text[];

-- per-event-type override. NULL = inherit the global default above;
-- a (possibly empty) array = this type's explicit list.
alter table event_types
  add column if not exists required_signing_fields text[];
