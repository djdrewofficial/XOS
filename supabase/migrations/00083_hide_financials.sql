-- Hide event financials (package pricing + payments) from the client app, on a
-- per-event-type default and a per-event override. Guests never see financials
-- (enforced in the app regardless of these flags).

-- Per-event-type default (false = show).
alter table event_types add column if not exists hide_financials boolean not null default false;

-- Per-event override: null = inherit the event type's default; true/false = force.
alter table events add column if not exists hide_financials boolean;
