-- Money-integrity backstop on events: fees and discounts must be non-negative.
-- The app coerced garbage to 0 via num() but let negatives through; this blocks
-- negatives at the database from EVERY write path (updateEventFinancials,
-- createEvent, onboarding, imports). package_price_override is nullable (null =
-- use the locked/catalog price), so it's only constrained when present.
alter table public.events
  add constraint events_discount1_nonneg check (discount1_amount >= 0),
  add constraint events_discount2_nonneg check (discount2_amount >= 0),
  add constraint events_overtime_fee_nonneg check (overtime_fee >= 0),
  add constraint events_travel_fee_nonneg check (travel_fee >= 0),
  add constraint events_deposit_value_nonneg check (deposit_value >= 0),
  add constraint events_package_override_nonneg check (package_price_override is null or package_price_override >= 0);
