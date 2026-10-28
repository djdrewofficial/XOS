-- Reliability indexes and three RLS initplan fixes.
-- NOT applied by the app. Drew reviews and runs this in the Supabase SQL editor.
--
-- These are the foreign keys the event page, the scheduled-payments report,
-- and the middleware permission lookup actually filter on, and that production
-- pg_indexes showed with no covering index. CREATE INDEX (not CONCURRENTLY)
-- because Supabase migrations run inside a transaction.
--
-- The policy changes only wrap auth.uid() in (select ...) so Postgres evaluates
-- it once per query instead of once per row. The role stays `authenticated`
-- and the rest of each expression is unchanged.

create index if not exists event_notes_event_created_idx
  on public.event_notes (event_id, created_at desc);

create index if not exists event_staff_event_idx
  on public.event_staff (event_id);

create index if not exists event_staff_employee_idx
  on public.event_staff (employee_id);

create index if not exists event_addons_event_idx
  on public.event_addons (event_id);

create index if not exists event_clients_client_idx
  on public.event_clients (client_id);

create index if not exists scheduled_payments_event_seq_idx
  on public.scheduled_payments (event_id, seq);

create index if not exists scheduled_payments_due_idx
  on public.scheduled_payments (due_date);

create index if not exists booking_helper_runs_event_idx
  on public.booking_helper_runs (event_id);

create index if not exists email_log_event_created_idx
  on public.email_log (event_id, created_at desc);

create index if not exists payments_scheduled_idx
  on public.payments (scheduled_payment_id);

drop policy if exists "read own account" on public.accounts;
create policy "read own account" on public.accounts
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists "own device tokens" on public.device_tokens;
create policy "own device tokens" on public.device_tokens
  for all
  to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

drop policy if exists "log write" on public.planning_audit_log;
create policy "log write" on public.planning_audit_log
  for insert
  to authenticated
  with check (
    xos_can_access_event(event_id)
    and actor_user_id = (select auth.uid())
  );
