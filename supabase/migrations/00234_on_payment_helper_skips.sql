-- On-payment booking helper skip rules (editable per helper).
-- Migration number 00234.
-- Do NOT apply from the agent (no prod migration / no deploy). Apply after merge.
--
-- Adds:
--   booking_helpers.on_payment_skip_hidden_financials
--   booking_helpers.on_payment_skip_paypal_thanked
--   email_log.payment_id  (links PayPal thank-you sends to the payment row)
-- Seeds both skip flags ON for "Send Payment Received Receipt".
-- Manual helper runs are unaffected (skip logic lives in runAutomations only).

alter table public.booking_helpers
  add column if not exists on_payment_skip_hidden_financials boolean not null default false;

alter table public.booking_helpers
  add column if not exists on_payment_skip_paypal_thanked boolean not null default false;

alter table public.email_log
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

create index if not exists email_log_payment_id_idx
  on public.email_log (payment_id)
  where payment_id is not null;

comment on column public.booking_helpers.on_payment_skip_hidden_financials is
  'When auto_on_payment fires: skip this helper if event_financials_hidden(event). Manual runs ignore this.';

comment on column public.booking_helpers.on_payment_skip_paypal_thanked is
  'When auto_on_payment fires: skip if this payment already got the PayPal thank-you email (email_log.payment_id). Manual runs ignore this.';

comment on column public.email_log.payment_id is
  'Optional payment this email is about (e.g. PayPal automatic thank-you receipt).';

-- Default ON for the Payment Received Receipt helper only.
update public.booking_helpers
set
  on_payment_skip_hidden_financials = true,
  on_payment_skip_paypal_thanked = true
where id = 'a0248b63-b1f1-45d8-ba83-0dc210167f56'
   or title = 'Send Payment Received Receipt';
