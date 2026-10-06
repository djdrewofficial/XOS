-- Per-event wording for the package and each add-on. NULL = use the catalog
-- description (or the pinned version snapshot). Edited on the event's
-- Financials tab; flows to the quote, proposal, contract and client app.
alter table public.events add column if not exists package_description_override text;
alter table public.event_addons add column if not exists description_override text;
