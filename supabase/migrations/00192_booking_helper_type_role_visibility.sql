-- Booking helper button visibility by event type and by staff role.
-- Empty array = no restriction (all types / all roles). Separate from
-- event_type_ids, which only scopes the helper's lifecycle automations.
-- master_admin can always use every helper (enforced in code).
alter table public.booking_helpers
  add column if not exists visible_event_type_ids uuid[] not null default '{}',
  add column if not exists allowed_roles text[] not null default '{}';
