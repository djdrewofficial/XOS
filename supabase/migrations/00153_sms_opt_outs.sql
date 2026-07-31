-- TCPA opt-out (STOP) handling. XOS previously relied entirely on HighLevel's DND
-- and kept no suppression list, so nothing stopped a booking-helper send_sms from
-- texting someone who replied STOP. This adds an XOS-owned opt-out list, checked
-- before every queued SMS is sent (see processSmsOutbox), populated automatically
-- from inbound STOP/START replies during conversation sync, and manageable by
-- staff per client.
--
-- Keyed by E.164 phone. A row with opted_out = true suppresses SMS to that number;
-- opted_out = false is an explicit re-subscribe (START / staff), kept for audit.
-- No row = subscribed (the default). signal_at is the timestamp of the signal that
-- set the current state, so re-syncing an old inbound message can never override a
-- newer opt-out/opt-in.

create table if not exists sms_opt_outs (
  phone      text primary key,           -- E.164, e.g. +19545551234
  opted_out  boolean not null default true,
  source     text,                        -- inbound_stop | inbound_start | manual | ghl_dnd
  reason     text,                        -- the keyword or a staff note
  signal_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_opt_outs_opted_idx on sms_opt_outs (opted_out);

alter table sms_opt_outs enable row level security;
drop policy if exists "staff only" on sms_opt_outs;
create policy "staff only" on sms_opt_outs
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());

-- Allow the outbox to mark a message it withheld because the recipient opted out.
alter table sms_log drop constraint if exists sms_log_status_check;
alter table sms_log add constraint sms_log_status_check
  check (status in ('queued','sent','failed','cancelled','suppressed'));
