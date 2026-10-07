-- When an event's total changes after a payment schedule exists, the event page
-- prompts the office to update the remaining payments. "Keep schedule as is"
-- records the total that was acknowledged so the prompt stays quiet until the
-- total changes again.
alter table public.events add column if not exists schedule_ack_total numeric;
