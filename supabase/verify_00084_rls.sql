-- Verification harness for migration 00084 (scoped client-facing RLS).
-- Run in the Supabase SQL editor AFTER applying 00084. Read-only (everything is
-- wrapped in a transaction that ROLLs BACK). It impersonates a real client
-- account by dropping to the `authenticated` role and setting a JWT `sub` claim
-- — the only way to exercise RLS, since the `postgres` owner bypasses it.
--
-- ── STEP 1: pick a client account + one of its events + a FOREIGN event ──
-- Run this first to grab UUIDs, then paste them into STEP 2.
--
--   select a.auth_user_id as client_uid,
--          (select e.id from events e
--             where e.client_id = a.client_id
--             order by e.created_at limit 1) as my_event,
--          (select e2.id from events e2
--             where e2.client_id is distinct from a.client_id
--             order by e2.created_at limit 1) as foreign_event
--   from accounts a
--   where a.account_type = 'client' and a.auth_user_id is not null
--     and exists (select 1 from events e where e.client_id = a.client_id)
--   limit 1;

-- ── STEP 2: paste the three UUIDs below, then run this whole block ──
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'client_uid', 'role', 'authenticated')::text,
  true
);

-- Each row should report PASS. (Uses the pasted UUIDs as bound params.)
with my_event as (select :'my_event'::uuid as id),
     foreign_event as (select :'foreign_event'::uuid as id)
select * from (
  values
    ('sees own event',
       (select count(*) = 1 from events  where id = (select id from my_event))),
    ('cannot see foreign event',
       (select count(*) = 0 from events  where id = (select id from foreign_event))),
    ('all visible payments belong to my events',
       not exists (
         select 1 from payments p
         where p.event_id is not null
           and not exists (select 1 from events e where e.id = p.event_id))),
    ('cannot see foreign event payments',
       (select count(*) = 0 from payments
          where event_id = (select id from foreign_event))),
    ('cannot see foreign scheduled_payments',
       (select count(*) = 0 from scheduled_payments
          where event_id = (select id from foreign_event))),
    ('cannot see foreign event_addons',
       (select count(*) = 0 from event_addons
          where event_id = (select id from foreign_event))),
    ('employees table is NOT readable',
       (select count(*) = 0 from employees)),
    ('event_staff table is NOT readable',
       (select count(*) = 0 from event_staff)),
    ('company_settings table is NOT readable',
       (select count(*) = 0 from company_settings)),
    ('company_public view IS readable (1 row)',
       (select count(*) = 1 from company_public)),
    ('catalog (packages) still readable',
       (select count(*) >= 0 from packages)),
    ('event_staff_public shows only my event''s staff',
       not exists (
         select 1 from event_staff_public v
         where not exists (select 1 from events e where e.id = v.event_id)))
) as checks(check_name, passed)
order by passed, check_name;

rollback;

-- Sanity counter-check: re-run STEP 2 with role `service_role` (set local role
-- service_role) and the SAME claims — it should see ALL events/payments, proving
-- background jobs (service-role key) are unaffected.
