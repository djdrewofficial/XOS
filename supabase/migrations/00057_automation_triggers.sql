-- XOS — Automation engine: generalize booking helpers into trigger→action
-- automations. `auto_on_create` + `auto_status_ids` already existed (dormant);
-- this adds the rest of the lifecycle triggers, an event-type scope, and an
-- optional outbound webhook (Zapier — powers Vibo, Drive, etc.). The webhook is
-- a COLUMN, not an action, so run_booking_helper() never sees an unknown type.

alter table booking_helpers add column if not exists auto_on_proposal_confirmed boolean not null default false;
alter table booking_helpers add column if not exists auto_on_signed boolean not null default false;
alter table booking_helpers add column if not exists auto_on_payment boolean not null default false;
-- which event types this automation applies to ('{}' = all types)
alter table booking_helpers add column if not exists event_type_ids uuid[] not null default '{}';
-- fire-and-forget POST to this URL after the helper runs (Zapier)
alter table booking_helpers add column if not exists webhook_url text;
