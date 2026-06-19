-- XOS — finish the RLS scoping started in 00084. The Supabase security advisor
-- flagged 69 tables still carrying the blanket "authenticated full access"
-- (USING true / WITH CHECK true) policy from 00001 — meaning any logged-in
-- account (including a client or event guest on the shared mobile-app auth) can
-- read/write them. This closes that.
--
-- Method (same helpers as 00084 / 00073):
--   * xos_is_staff()            -> staff/owner: full read+write.
--   * xos_can_access_event(eid) -> a client/guest attached to that event.
--   * xos_my_client_id()        -> (new) the current login's own client id.
--
-- Categorisation comes from an audit of every NON-staff read path:
--   - xpress-client mobile app (user session): events, event_types, event_addons,
--     payments, scheduled_payments, packages, addons, accounts, clients,
--     event_guests, event_clients, vendor_categories, vendors, event_vendors,
--     planning_*  (all subject to RLS).
--   - XOS /portal (logged-in client session): accounts, clients, events,
--     event_clients, event_guests, planning_*, and a vendors SELECT (searchVendors).
--   - XOS /proposal, /sign, /pay (public token pages): use the SERVICE-ROLE admin
--     client -> bypass RLS -> unaffected. Likewise the /portal vendor *writes*.
-- Anything no non-staff path reads is locked to staff only.
--
-- All policies are dropped-then-created so this migration is safe to re-run.

-- ── new helper: the current login's own client id (null for staff/guests) ──
create or replace function xos_my_client_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select client_id from accounts
  where auth_user_id = auth.uid() and account_type = 'client'
  limit 1;
$$;

-- ════════════════ 1) STAFF-ONLY TABLES (no client-facing read) ════════════════
-- Lock the blanket policy down to staff. Per-screen RBAC stays in the app layer
-- (requireModule); RLS here only separates staff from clients/guests.
do $$
declare t text;
begin
  foreach t in array array[
    'addon_categories','addon_equipment_defaults','addon_versions',
    'booking_helper_runs','booking_helpers','client_notes','client_role_definitions',
    'custom_date_definitions','daily_status_actions','dashboard_layouts',
    'document_templates','document_views','documents','email_log','email_templates',
    'employee_permissions','employee_time_off','equipment_damage_reports',
    'equipment_items','equipment_photos','equipment_storage_locations','equipment_systems',
    'event_custom_dates','event_equipment','event_files','event_logs','event_notes',
    'event_trips','expense_categories','expense_settings','expenses',
    'hl_conversations','hl_messages','hl_sync_state','inquiry_sources','journey_settings',
    'kb_articles','notifications','package_addon_defaults','package_categories',
    'package_date_prices','package_equipment_defaults','package_versions','payment_settings',
    'payroll_payables','payroll_payments','payroll_settings','role_permissions','role_settings',
    'scheduled_email_runs','sms_log','staff_settings','timesheet_change_requests','vehicles',
    'vendor_contacts','venue_categories','venue_contacts','venue_djep_map','venue_rooms','venues'
  ] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "staff only" on public.%I', t);
    execute format(
      'create policy "staff only" on public.%I for all to authenticated using (xos_is_staff()) with check (xos_is_staff())', t);
  end loop;
end $$;

-- ═══════════ 2) REFERENCE TABLES (non-sensitive: staff write, all read) ═══════════
-- event_types is read by the mobile app (hide_financials lookup); the others are
-- harmless lookup data. Staff write; any authenticated login may read.
do $$
declare t text;
begin
  foreach t in array array['event_types','event_statuses','vendor_categories'] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "staff write %s" on public.%I', t, t);
    execute format('drop policy if exists "read %s" on public.%I', t, t);
    execute format(
      'create policy "staff write %s" on public.%I for all to authenticated using (xos_is_staff()) with check (xos_is_staff())', t, t);
    execute format(
      'create policy "read %s" on public.%I for select to authenticated using (true)', t, t);
  end loop;
end $$;

-- ════════════════ 3) PER-ACCOUNT / PER-EVENT SCOPED TABLES ════════════════

-- accounts: a login reads only its own account row; staff manage all.
drop policy if exists "authenticated full access" on accounts;
drop policy if exists "staff manage accounts" on accounts;
drop policy if exists "read own account" on accounts;
create policy "staff manage accounts" on accounts
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
create policy "read own account" on accounts
  for select to authenticated using (auth_user_id = auth.uid());

-- clients (PII): a client login reads only its own client row; staff manage all.
drop policy if exists "authenticated full access" on clients;
drop policy if exists "staff manage clients" on clients;
drop policy if exists "read own client" on clients;
create policy "staff manage clients" on clients
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
create policy "read own client" on clients
  for select to authenticated using (id = xos_my_client_id());

-- event_guests: read scoped to the guest's / client's event; staff manage all.
drop policy if exists "authenticated full access" on event_guests;
drop policy if exists "staff manage event guests" on event_guests;
drop policy if exists "read own event guests" on event_guests;
create policy "staff manage event guests" on event_guests
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
create policy "read own event guests" on event_guests
  for select to authenticated using (xos_can_access_event(event_id));

-- event_clients: read scoped to the client's event; staff manage all.
drop policy if exists "authenticated full access" on event_clients;
drop policy if exists "staff manage event clients" on event_clients;
drop policy if exists "read own event clients" on event_clients;
create policy "staff manage event clients" on event_clients
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
create policy "read own event clients" on event_clients
  for select to authenticated using (xos_can_access_event(event_id));

-- vendors: shared business directory. Staff manage (update/delete); anyone may
-- read (the mobile app joins it and reads back its own insert); any authenticated
-- login may insert (the couple adds a vendor to their team).
drop policy if exists "authenticated full access" on vendors;
drop policy if exists "staff manage vendors" on vendors;
drop policy if exists "read vendors" on vendors;
drop policy if exists "client add vendors" on vendors;
create policy "staff manage vendors" on vendors
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
create policy "read vendors" on vendors
  for select to authenticated using (true);
create policy "client add vendors" on vendors
  for insert to authenticated with check (true);

-- event_vendors: the couple's per-event vendor roster — full access scoped to
-- their own event (covers staff too, since xos_can_access_event is true for staff).
drop policy if exists "authenticated full access" on event_vendors;
drop policy if exists "event access event vendors" on event_vendors;
create policy "event access event vendors" on event_vendors
  for all to authenticated
  using (xos_can_access_event(event_id))
  with check (xos_can_access_event(event_id));
