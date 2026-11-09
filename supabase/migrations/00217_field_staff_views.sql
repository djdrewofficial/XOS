-- Field staff (permission_tier employee / marketing): assigned events only, no
-- money except their own wage. PART 1 of 2 — additive, safe to ship first.
--
-- This migration:
--   1. adds the access helpers (xos_is_field_staff, xos_sees_all_events,
--      xos_assigned_event_ids, xos_is_assigned, xos_assigned_client_ids,
--      xos_dj_client_ids, xos_fs_can_read_object, …)
--   2. narrows xos_is_host() — and so xos_can_access_event() — for field staff
--      to the events they are assigned to (office tiers, clients, hosts and
--      guests are unchanged)
--   3. scopes the event-files storage bucket read for field staff to timeline
--      files of assigned events (00144 follow-up), and storage writes to office
--   4. render_merge_tags: field staff render only assigned events, with every
--      money tag blank (re-uses the existing venue-paid "financials hidden" path)
--   5. xos_can_hide_ugc: field staff only on assigned events
--   6. guard trigger on event_staff: field staff may only stamp
--      notified/confirmed/declined/checked-in/checked-out on their OWN row
--   7. the money-free read views the web + mobile code against:
--        xos_fs_events, xos_fs_venues, xos_fs_packages, xos_fs_event_addons,
--        xos_fs_event_staff, xos_fs_employees
--   8. indexes + hl_conversations.client_id backfill
--
-- 00218 then adds the restrictive "field staff scope" policies that deny field
-- staff the base money tables / events / venues (they read the views instead).
--
-- Who is field staff: an employees row linked to the login whose tier is
-- employee or marketing, OR whose tier is NULL (fails closed). Owner logins
-- with no employees row (accounts.account_type = 'staff' only) are NOT field
-- staff — xos_current_tier() reports them as master_admin.
--
-- Note on the views: they are deliberately security_invoker = false (they run
-- as their owner and filter rows themselves with the helpers below) so they
-- can read the base tables field staff are denied in 00218. They are
-- security_barrier, SELECT-only (every write privilege revoked — a simple view
-- is auto-updatable and would otherwise write through as the owner), and
-- return nothing to non-staff. Supabase's advisor flags definer views
-- (0010_security_definer_view); that is expected for these six.
--
-- Safe to re-run.

-- ───────────────────────────── 1. helpers ─────────────────────────────

create or replace function public.xos_is_field_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- The web resolves the employee via accounts.employee_id first, then
  -- employees.auth_user_id; check both links so neither can fail open.
  select auth.uid() is not null and exists (
    select 1 from employees e
    where (e.auth_user_id = auth.uid()
           or e.id in (select a.employee_id from accounts a
                       where a.auth_user_id = auth.uid() and a.account_type = 'staff'))
      and (e.permission_tier is null or e.permission_tier in ('employee', 'marketing'))
  );
$$;

-- true for office tiers AND for every non-employee login (clients, guests): the
-- restrictive 00218 policies are `xos_sees_all_events() or <scope>`, so they
-- only ever bite field staff; clients keep their existing permissive policies.
create or replace function public.xos_sees_all_events()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.xos_is_field_staff();
$$;

create or replace function public.xos_assigned_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct es.event_id
  from event_staff es
  where es.employee_id = public.xos_current_employee_id()
    and es.event_id is not null;
$$;

create or replace function public.xos_is_assigned(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from event_staff es
    where es.event_id = p_event_id
      and es.employee_id = public.xos_current_employee_id()
  );
$$;

-- clients of assigned events: the event's primary client + every event_clients row
create or replace function public.xos_assigned_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.client_id from events e
  join event_staff es on es.event_id = e.id
  where es.employee_id = public.xos_current_employee_id() and e.client_id is not null
  union
  select ec.client_id from event_clients ec
  join event_staff es on es.event_id = ec.event_id
  where es.employee_id = public.xos_current_employee_id() and ec.client_id is not null;
$$;

-- conversations rule: clients of events where the caller's assignment role
-- contains "DJ" (matches "DJ", "DJ (Assigned)", "DJ (Requested)", "DJ Requested")
create or replace function public.xos_dj_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.client_id from events e
  join event_staff es on es.event_id = e.id
  where es.employee_id = public.xos_current_employee_id()
    and es.role ilike '%dj%' and e.client_id is not null
  union
  select ec.client_id from event_clients ec
  join event_staff es on es.event_id = ec.event_id
  where es.employee_id = public.xos_current_employee_id()
    and es.role ilike '%dj%' and ec.client_id is not null;
$$;

-- true when the caller is office, or field staff for whom this client is in the DJ set
create or replace function public.xos_can_message_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.xos_is_staff() and (
    public.xos_sees_all_events()
    or (p_client_id is not null and p_client_id in (select public.xos_dj_client_ids()))
  );
$$;

create or replace function public.xos_can_read_conversation(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.xos_is_staff() and (
    public.xos_sees_all_events()
    or exists (
      select 1 from hl_conversations c
      where c.id = p_conversation_id
        and c.client_id in (select public.xos_dj_client_ids())
    )
  );
$$;

-- event_files a field-staff login may see: timeline files of assigned events
create or replace function public.xos_fs_can_read_event_file(p_event_id uuid, p_label_id uuid, p_source text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.xos_is_assigned(p_event_id) and (
    p_source = 'planner_timeline'
    or exists (select 1 from file_label_definitions l where l.id = p_label_id and l.slug = 'timeline')
  );
$$;

-- storage object (event-files bucket, `<eventId>/...`) a field-staff login may read
create or replace function public.xos_fs_can_read_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.xos_is_field_staff()
    and (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and exists (
      select 1 from event_files f
      where f.path = p_name
        and f.event_id = ((storage.foldername(p_name))[1])::uuid
        and public.xos_fs_can_read_event_file(f.event_id, f.label_id, f.source)
    );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'xos_is_field_staff()', 'xos_sees_all_events()', 'xos_assigned_event_ids()',
    'xos_is_assigned(uuid)', 'xos_assigned_client_ids()', 'xos_dj_client_ids()',
    'xos_can_message_client(uuid)', 'xos_can_read_conversation(text)',
    'xos_fs_can_read_event_file(uuid,uuid,text)', 'xos_fs_can_read_object(text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ─────────── 2. xos_is_host / xos_can_access_event: assigned only ───────────
-- xos_can_access_event() = xos_is_host() or xos_guest_of(); the staff branch of
-- xos_is_host() returned true for EVERY event. Field staff now only pass for
-- events they are assigned to. Policies that call xos_is_host directly
-- ("read own events", "event access event vendors", planning host policies)
-- narrow the same way.
create or replace function public.xos_is_host(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (public.xos_is_staff()
      and (public.xos_sees_all_events() or public.xos_is_assigned(p_event_id)))
    or exists (
      select 1 from public.accounts a
      where a.auth_user_id = auth.uid()
        and a.account_type = 'client'
        and (
          exists (
            select 1 from public.event_clients ec
            where ec.event_id = p_event_id and ec.client_id = a.client_id
          )
          or exists (
            select 1 from public.events e
            where e.id = p_event_id and e.client_id = a.client_id
          )
        )
    )
    or exists (
      select 1 from public.event_app_members m
      where m.event_id = p_event_id
        and m.auth_user_id = auth.uid()
        and m.role = 'host'
    );
$$;

-- ugc moderation: staff override only on events the caller may see
create or replace function public.xos_can_hide_ugc(p_event_id uuid, p_author_id uuid, p_shared boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.xos_is_staff() and (public.xos_sees_all_events() or public.xos_is_assigned(p_event_id)) then
    return true;
  end if;
  if p_author_id is not null and p_author_id = auth.uid() then
    return true;
  end if;
  if public.xos_is_host(p_event_id) and p_shared then
    return true;
  end if;
  if public.xos_is_host(p_event_id) and (p_author_id is null or public.xos_user_is_guest(p_event_id, p_author_id)) then
    return true;
  end if;
  return false;
end;
$$;

-- ─────────── 3. event-files bucket (00144 follow-up) ───────────
-- Prod also carries a permissive "event-files staff read" (bucket + xos_is_staff())
-- that is not in any migration file; it would OR every file back open to field
-- staff, so it goes. Non-staff keep exactly the live rule (hosts of the event via
-- xos_is_host — event guests were never granted bucket reads).
drop policy if exists "event-files staff read" on storage.objects;
drop policy if exists "event-files read scoped" on storage.objects;
create policy "event-files read scoped" on storage.objects for select to authenticated
  using (
    bucket_id = 'event-files'
    and (
      (xos_is_staff() and xos_sees_all_events())
      or xos_fs_can_read_object(name)
      or (
        not xos_is_staff()
        and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        and xos_is_host(((storage.foldername(name))[1])::uuid)
      )
    )
  );

drop policy if exists "event-files staff write" on storage.objects;
create policy "event-files staff write" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-files' and xos_is_staff() and xos_sees_all_events());

drop policy if exists "event-files staff delete" on storage.objects;
create policy "event-files staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-files' and xos_is_staff() and xos_sees_all_events());

-- ─────────── 4. render_merge_tags: assigned only, money blank ───────────
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  a_access text := $a$  if auth.uid() is not null and not xos_is_staff() and not xos_can_access_event(p_event_id) then$a$;
  r_access text := $a$  if auth.uid() is not null and not (xos_is_staff() and xos_sees_all_events()) and not xos_can_access_event(p_event_id) then$a$;
  a_money text := $a$  if event_financials_hidden(e.id) then$a$;
  r_money text := $a$  if event_financials_hidden(e.id) or (auth.uid() is not null and xos_is_field_staff()) then$a$;
begin
  if position('xos_is_field_staff()' in src) > 0 then
    return; -- already patched
  end if;
  if (length(src) - length(replace(src, a_access, ''))) / length(a_access) <> 1 then
    raise exception 'render_merge_tags: caller-access anchor not found exactly once';
  end if;
  if (length(src) - length(replace(src, a_money, ''))) / length(a_money) <> 1 then
    raise exception 'render_merge_tags: financials-hidden anchor not found exactly once';
  end if;
  src := replace(src, a_access, r_access);
  src := replace(src, a_money, r_money);
  execute src;
end
$mig$;

-- ─────────── 6. event_staff guard ───────────
-- Field staff (user session) may only UPDATE their own row, and only the
-- self-service stamps. Service role (auth.uid() null) and office are untouched.
create or replace function public.xos_event_staff_field_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array['notified_at', 'confirmed_at', 'declined_at', 'checked_in_at', 'checked_out_at'];
begin
  if auth.uid() is null or not public.xos_is_field_staff() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'field staff cannot % event staff assignments', lower(tg_op) using errcode = '42501';
  end if;
  if old.employee_id is distinct from public.xos_current_employee_id() then
    raise exception 'field staff can only update their own assignment' using errcode = '42501';
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'field staff can only update check-in/confirmation fields' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.xos_event_staff_field_guard() from public, anon, authenticated;

drop trigger if exists event_staff_field_guard on public.event_staff;
create trigger event_staff_field_guard
  before insert or update or delete on public.event_staff
  for each row execute function public.xos_event_staff_field_guard();

-- employees guard: today every staff login may update any employees row under
-- "staff manage employees", including permission_tier — an employee could make
-- themselves master_admin. Field staff may only edit their OWN row, and never
-- the access / pay columns.
create or replace function public.xos_employees_field_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  locked text[] := array['id', 'auth_user_id', 'permission_tier', 'hourly_rate', 'addon_commission_pct',
                         'sales_commission_pct', 'check_in_required', 'is_active', 'employment_type',
                         'staff_category', 'landing_page', 'can_send_as_self', 'display_order',
                         'hl_contact_id', 'legacy_djep_id', 'email'];
  k text;
begin
  if auth.uid() is null or not public.xos_is_field_staff() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'field staff cannot % employees', lower(tg_op) using errcode = '42501';
  end if;
  if old.auth_user_id is distinct from auth.uid() then
    raise exception 'field staff can only update their own profile' using errcode = '42501';
  end if;
  foreach k in array locked loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      raise exception 'field staff cannot change employees.%', k using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.xos_employees_field_guard() from public, anon, authenticated;

drop trigger if exists employees_field_guard on public.employees;
create trigger employees_field_guard
  before insert or update or delete on public.employees
  for each row execute function public.xos_employees_field_guard();

-- ─────────── 7. money-free views ───────────
-- Row rule for every view: staff only; office unfiltered; field staff = assigned.

drop view if exists public.xos_fs_events;
create view public.xos_fs_events with (security_invoker = false, security_barrier = true) as
select
  e.id, e.event_number, e.name, e.event_date, e.setup_time, e.start_time, e.end_time,
  e.guest_count, e.client_id, e.venue_id, e.venue_room_id, e.use_client_address,
  e.package_id, e.package_version_no, e.package_description_override,
  e.status_id, e.event_type_id, e.salesperson_id, e.inquiry_source_id,
  e.point_of_contact_employee_id, e.journey_type_id,
  e.internal_notes, e.custom_fields, e.planning_seeded, e.planning_template_id,
  e.overtime_hours, e.hide_financials, e.comms_paused,
  e.initial_contact_date, e.quote_sent_date, e.contract_sent_date, e.contract_due_date,
  e.contract_signed_date, e.booked_date,
  e.decision_maker_name, e.decision_maker_phone, e.decision_maker_email,
  e.cover_photo_url, e.cover_photo_updated_by, e.cover_photo_hidden_at, e.cover_photo_hidden_by,
  e.archived_at, e.created_at, e.updated_at
from public.events e
where public.xos_is_staff()
  and (public.xos_sees_all_events() or public.xos_is_assigned(e.id));

drop view if exists public.xos_fs_venues;
create view public.xos_fs_venues with (security_invoker = false, security_barrier = true) as
select
  v.id, v.name, v.address, v.city, v.state, v.zip, v.distance_miles, v.travel_minutes,
  v.load_in_details, v.driving_notes, v.notes, v.category, v.category_id, v.is_one_time,
  v.external_links, v.auto_mileage, v.lat, v.lng, v.google_place_id,
  v.contact_name, v.phone, v.email, v.website, v.archived_at, v.created_at
from public.venues v
where public.xos_is_staff();

drop view if exists public.xos_fs_packages;
create view public.xos_fs_packages with (security_invoker = false, security_barrier = true) as
select p.id, p.name, p.description, p.included_hours
from public.packages p
where public.xos_is_staff();

drop view if exists public.xos_fs_event_addons;
create view public.xos_fs_event_addons with (security_invoker = false, security_barrier = true) as
select
  ea.id, ea.event_id, ea.addon_id, ea.quantity,
  a.name,
  coalesce(ea.description_override, a.description) as description
from public.event_addons ea
left join public.addons a on a.id = ea.addon_id
where public.xos_is_staff()
  and (public.xos_sees_all_events() or public.xos_is_assigned(ea.event_id));

drop view if exists public.xos_fs_event_staff;
create view public.xos_fs_event_staff with (security_invoker = false, security_barrier = true) as
select
  es.id, es.event_id, es.employee_id, es.role,
  em.first_name, em.last_name, em.stage_name,
  es.start_time, es.end_time, es.notes, es.portal_visible,
  es.notified_at, es.confirmed_at, es.declined_at, es.checked_in_at, es.checked_out_at,
  case
    when public.xos_sees_all_events() or es.employee_id = public.xos_current_employee_id()
      then es.flat_wage
  end as flat_wage
from public.event_staff es
left join public.employees em on em.id = es.employee_id
where public.xos_is_staff()
  and (public.xos_sees_all_events() or public.xos_is_assigned(es.event_id));

drop view if exists public.xos_fs_employees;
create view public.xos_fs_employees with (security_invoker = false, security_barrier = true) as
select em.id, em.first_name, em.last_name, em.stage_name
from public.employees em
where public.xos_is_staff();

-- SELECT only, authenticated only (Supabase default privileges grant ALL on new
-- relations to anon/authenticated — strip them first).
do $$
declare v text;
begin
  foreach v in array array['xos_fs_events', 'xos_fs_venues', 'xos_fs_packages',
                           'xos_fs_event_addons', 'xos_fs_event_staff', 'xos_fs_employees']
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to authenticated, service_role', v);
  end loop;
end $$;

-- ─────────── 8. indexes + backfill ───────────
create index if not exists event_staff_employee_event_idx on public.event_staff (employee_id, event_id);
create index if not exists event_clients_client_event_idx on public.event_clients (client_id, event_id);
create index if not exists event_files_event_label_idx on public.event_files (event_id, label_id);
create index if not exists sms_log_client_idx on public.sms_log (client_id);
-- hl_conversations(client_id) already exists (hl_conversations_client_idx)

-- The DB conversation rule only uses hl_conversations.client_id; the web also
-- matched by phone/email at render time. Fill the gaps with the sync's own rule
-- (last 10 phone digits first, then lower-cased email; earliest client wins).
update public.hl_conversations c
set client_id = m.client_id
from (
  select c2.id,
    coalesce(
      (select cl.id from public.clients cl
        where length(regexp_replace(coalesce(c2.phone, ''), '\D', '', 'g')) >= 10
          and right(regexp_replace(coalesce(cl.cell_phone, ''), '\D', '', 'g'), 10)
            = right(regexp_replace(c2.phone, '\D', '', 'g'), 10)
        order by cl.created_at limit 1),
      (select cl.id from public.clients cl
        where nullif(trim(c2.email), '') is not null
          and lower(trim(cl.email)) = lower(trim(c2.email))
        order by cl.created_at limit 1)
    ) as client_id
  from public.hl_conversations c2
  where c2.client_id is null
) m
where c.id = m.id and c.client_id is null and m.client_id is not null;

notify pgrst, 'reload schema';
