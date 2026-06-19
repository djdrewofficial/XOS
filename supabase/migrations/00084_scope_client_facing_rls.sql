-- XOS — Scope the blanket RLS on client-facing tables.
--
-- 00001 enabled RLS on every public table with a single permissive policy
-- ("authenticated full access": USING true / WITH CHECK true, FOR ALL). That was
-- fine when the only logins were the trusted internal team. It is NOT fine now:
-- the Xpress client mobile app logs clients and event guests in through the same
-- Supabase auth, so today EVERY authenticated account can read (and per the ALL
-- policy, write) EVERY row of payments, employees (hourly_rate, commissions,
-- emergency_contact…), events, catalog, company_settings, etc.
--
-- This migration replaces those permissive policies on the client-facing tables
-- with per-account scoping, mirroring the pattern 00073 already uses for the
-- planning tables:
--   * xos_is_staff()                -> full read+write (staff / no-account owner).
--   * xos_can_access_event(eid)     -> a client/guest attached to that event.
-- Policies are split SELECT vs ALL so staff keep write access while clients get
-- read-only, event-scoped visibility. Background jobs use the service-role key,
-- which bypasses RLS entirely, so they are unaffected.
--
-- Columns that must never reach a client (employee pay, event_staff wages,
-- internal company settings) are exposed — when needed — only through narrow
-- security-definer VIEWS that select safe columns and self-scope by event.
--
-- See xos/src/.. (XOS web, staff) and xpress-client/src/lib/{account,planning}.ts
-- (the mobile app, clients) for the read shapes this is coordinated against.

-- ───────────────────────── Per-event financial rows ─────────────────────────
-- Client app (account.ts) reads these filtered by event_id; never writes them.
-- Staff keep full access; clients/guests read only their own event's rows.

drop policy if exists "authenticated full access" on payments;
do $$ begin
  create policy "staff write payments" on payments
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read own event payments" on payments
    for select to authenticated using (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;

drop policy if exists "authenticated full access" on scheduled_payments;
do $$ begin
  create policy "staff write scheduled payments" on scheduled_payments
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read own event scheduled payments" on scheduled_payments
    for select to authenticated using (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;

drop policy if exists "authenticated full access" on event_addons;
do $$ begin
  create policy "staff write event addons" on event_addons
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read own event addons" on event_addons
    for select to authenticated using (xos_can_access_event(event_id));
exception when duplicate_object then null; end $$;

-- ───────────────────────────────── Events ──────────────────────────────────
-- The row IS the event, so scope on its own id. xos_can_access_event is
-- SECURITY DEFINER (bypasses RLS), so referencing events inside it does not
-- recurse into this policy. Staff write; clients/guests read their own event(s).

drop policy if exists "authenticated full access" on events;
do $$ begin
  create policy "staff write events" on events
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read own events" on events
    for select to authenticated using (xos_can_access_event(id));
exception when duplicate_object then null; end $$;

-- ───────────────────────────────── Catalog ─────────────────────────────────
-- packages / addons are non-sensitive catalog data the client app resolves
-- names + prices from. Keep them readable to any authenticated login; restrict
-- writes to staff (the catalog editors).

drop policy if exists "authenticated full access" on packages;
do $$ begin
  create policy "staff write packages" on packages
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read packages" on packages
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

drop policy if exists "authenticated full access" on addons;
do $$ begin
  create policy "staff write addons" on addons
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read addons" on addons
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- ──────────────────────── Staff records (sensitive) ────────────────────────
-- employees holds hourly_rate, sales/addon commission %, phone, emergency
-- contact, birthday. event_staff holds wages (flat_wage, pay_type, paid_at).
-- Neither may be readable by a client/guest. Staff-only, full stop. Clients that
-- need to see the team for their event read the safe view below instead.

drop policy if exists "authenticated full access" on employees;
do $$ begin
  create policy "staff manage employees" on employees
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

drop policy if exists "authenticated full access" on event_staff;
do $$ begin
  create policy "staff manage event staff" on event_staff
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- ──────────────────────────── Company settings ─────────────────────────────
-- Staff-only. The client app only needs from_email / reply_to / company_name —
-- served by the company_public view below.

drop policy if exists "authenticated full access" on company_settings;
do $$ begin
  create policy "staff manage company settings" on company_settings
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- ─────────────────────── Public-safe views (client app) ─────────────────────
-- These are SECURITY DEFINER views (security_invoker = off): they intentionally
-- bypass the base-table RLS to expose ONLY safe columns, and self-scope rows via
-- their own WHERE (xos_can_access_event / a fixed single row). This is the
-- "narrow view" escape hatch 00073's notes anticipated. (The Supabase advisor
-- will flag them as security-definer views — that is deliberate here.)

-- Company identity the client app shows in its "Contact our team" card.
create or replace view company_public
  with (security_invoker = off) as
  select company_name, from_email, reply_to
  from company_settings
  where id = true;
grant select on company_public to anon, authenticated;

-- The staff assigned to a client's event, limited to portal-visible rows and
-- safe contact columns. Staff (xos_can_access_event => true) see every event's
-- roster; a client/guest sees only their own event's portal-visible staff.
create or replace view event_staff_public
  with (security_invoker = off) as
  select
    es.event_id,
    es.role,
    nullif(trim(coalesce(em.first_name, '') || ' ' || coalesce(em.last_name, '')), '') as name,
    em.email,
    em.phone
  from event_staff es
  join employees em on em.id = es.employee_id
  where es.portal_visible
    and xos_can_access_event(es.event_id);
grant select on event_staff_public to authenticated;
