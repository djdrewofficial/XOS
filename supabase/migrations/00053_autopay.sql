-- XOS — Autopay (Phase 3): vault the client's PayPal payment method on their
-- first /welcome payment, then a daily cron charges each scheduled payment on
-- its due date. Consent was captured at /proposal (00050: events.autopay_*).

-- where the vaulted payment method lives once armed
alter table events add column if not exists autopay_vault_id text;
alter table events add column if not exists autopay_customer_id text;
alter table events add column if not exists autopay_armed_at timestamptz;

-- per-scheduled-payment attempt tracking so a failing card isn't retried forever
alter table scheduled_payments add column if not exists autopay_attempts int not null default 0;
alter table scheduled_payments add column if not exists autopay_last_attempt_at timestamptz;
alter table scheduled_payments add column if not exists autopay_last_error text;
