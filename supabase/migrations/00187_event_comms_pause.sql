-- Per-event "pause automated communications" — for events run in parallel with an
-- external system (e.g. DJEP) during migration. When paused, client-facing email +
-- SMS are suppressed at the outbox drain (claim_email_outbox / claim_sms_outbox →
-- processOutbox / processSmsOutbox). Staff/internal alerts (client_id null) still fire.
alter table public.events add column if not exists comms_paused boolean not null default false;

-- Idempotency anchor for the DJEP → XOS event importer (clients/venues/etc. already
-- carry legacy_djep_id; events did not). Unique so re-imports upsert instead of dupe.
alter table public.events add column if not exists legacy_djep_id text;
create unique index if not exists events_legacy_djep_id_key on public.events(legacy_djep_id)
  where legacy_djep_id is not null;
