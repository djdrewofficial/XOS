-- XOS — PayPal payments: clients pay the retainer/balance from a branded
-- public pay page (/pay/[token]). Captures record into the existing payments
-- table; paypal_capture_id makes recording idempotent across the capture
-- response AND the webhook (whichever lands first wins).

-- per-event unguessable token for the public pay link (same pattern as
-- documents.access_token for /sign)
alter table events add column if not exists pay_token uuid not null default gen_random_uuid();
create unique index if not exists events_pay_token_idx on events(pay_token);

-- NOTE: payments.method is free text (the method check was dropped in 00028,
-- driven by the configurable methods list) — PayPal records method 'paypal'
-- with no constraint to add.

-- the PayPal capture id — unique so a capture is recorded exactly once even if
-- the capture endpoint and the webhook both fire
alter table payments add column if not exists paypal_capture_id text;
create unique index if not exists payments_paypal_capture_idx
  on payments(paypal_capture_id) where paypal_capture_id is not null;
