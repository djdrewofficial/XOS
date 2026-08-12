-- Money-integrity backstop: block negative payment amounts at the database, the
-- single chokepoint every insert path passes through (manual addPayment, the
-- Zelle-pending route, PayPal recording). num() in the app coerces bad input to
-- 0 and let negatives through; a negative "payment" would inflate a client's
-- balance or wipe a real one.
--
-- Non-negative (>= 0), NOT strictly positive: scheduled_payments legitimately
-- holds $0 installment rows (e.g. when the deposit covers the full total), and
-- there is one such row live today. The app enforces > 0 for manual payment
-- entry; the DB floor just forbids negatives everywhere.

alter table public.payments
  add constraint payments_amount_nonneg check (amount >= 0);

alter table public.scheduled_payments
  add constraint scheduled_payments_amount_nonneg check (amount >= 0);
