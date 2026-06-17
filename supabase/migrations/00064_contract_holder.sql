-- XOS — explicit "Contract Holder" flag on event_clients (separate from the
-- primary/naming client). The admin-entered client defaults to contract holder
-- and can also carry a Partner A/B role. Drives the contract_holder signing
-- requirement (falls back to is_primary for events created before this).
alter table event_clients add column if not exists is_contract_holder boolean not null default false;
