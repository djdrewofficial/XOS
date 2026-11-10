-- Field-staff lockdown test (migrations 00217 + 00218).
--
-- Self-contained: creates its own fixtures (fixed test UUIDs) inside ONE
-- transaction, impersonates each persona, and ROLLS BACK at the end, so it
-- leaves nothing behind. Paste the whole file into the Supabase SQL editor (or
-- `psql -f`) AFTER applying 00217 and 00218. The last result set lists every
-- check with PASS/FAIL; the final row is the summary.
--
-- Impersonation = `set local role authenticated` + a `request.jwt.claims` sub —
-- the only way to exercise RLS (the postgres owner bypasses it).
--
-- Personas: master_admin, admin, salesperson (office) · employee (DJ on event A,
-- "Setup / Takedown" on event B, nothing on C) · marketing (no assignments) ·
-- employee linked only via accounts.employee_id (must still be field staff) ·
-- client (primary client of A)
-- · guest (event_app_members guest on A) · anon.
--
-- With ONLY 00217 applied, the base-table denial rows (events/payments/packages/
-- documents/clients/employees/conversations/event_notes C/sms C/role_permissions)
-- are expected to FAIL; the view, wage, storage, render_merge_tags and
-- trigger rows already PASS. (Two client rows then also fail as a knock-on:
-- the employee events-rename and payment insert succeed without 00218.)

begin;

create temp table _r (seq serial, persona text, check_name text, ok boolean) on commit drop;
grant all on _r to authenticated, anon;
grant all on sequence _r_seq_seq to authenticated, anon;

-- ───────────── fixtures (as postgres) ─────────────
insert into auth.users (id, email) values
  ('f5000000-0000-4000-8000-000000000001', 'fs-master@test.invalid'),
  ('f5000000-0000-4000-8000-000000000002', 'fs-admin@test.invalid'),
  ('f5000000-0000-4000-8000-000000000003', 'fs-sales@test.invalid'),
  ('f5000000-0000-4000-8000-000000000004', 'fs-employee@test.invalid'),
  ('f5000000-0000-4000-8000-000000000005', 'fs-marketing@test.invalid'),
  ('f5000000-0000-4000-8000-000000000006', 'fs-acctlinked@test.invalid'),
  ('f5000000-0000-4000-8000-000000000007', 'fs-client@test.invalid'),
  ('f5000000-0000-4000-8000-000000000008', 'fs-guest@test.invalid'),
  ('f5000000-0000-4000-8000-000000000009', 'fs-other@test.invalid');

insert into employees (id, auth_user_id, first_name, last_name, stage_name, permission_tier) values
  ('f5e00000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'Master', 'Test', null, 'master_admin'),
  ('f5e00000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'Admin', 'Test', null, 'admin'),
  ('f5e00000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000003', 'Sales', 'Test', null, 'salesperson'),
  ('f5e00000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000004', 'Emp', 'Test', 'DJ Emp', 'employee'),
  ('f5e00000-0000-4000-8000-000000000005', 'f5000000-0000-4000-8000-000000000005', 'Mark', 'Test', null, 'marketing'),
  ('f5e00000-0000-4000-8000-000000000009', 'f5000000-0000-4000-8000-000000000009', 'Other', 'Dj', 'DJ Other', 'employee'),
  -- linked ONLY through accounts.employee_id (employees.auth_user_id empty)
  ('f5e00000-0000-4000-8000-000000000006', null, 'Acct', 'Linked', null, 'employee');

insert into accounts (auth_user_id, account_type, employee_id)
select e.auth_user_id, 'staff', e.id from employees e where e.id::text like 'f5e00000-%' and e.auth_user_id is not null;
insert into accounts (auth_user_id, account_type, employee_id)
values ('f5000000-0000-4000-8000-000000000006', 'staff', 'f5e00000-0000-4000-8000-000000000006');

insert into clients (id, first_name, last_name, cell_phone, email) values
  ('f5c00000-0000-4000-8000-00000000000a', 'Client', 'A', '(555) 010-0001', 'fs-a@test.invalid'),
  ('f5c00000-0000-4000-8000-00000000000b', 'Client', 'B', '(555) 010-0002', 'fs-b@test.invalid'),
  ('f5c00000-0000-4000-8000-00000000000c', 'Client', 'C', '(555) 010-0003', 'fs-c@test.invalid');

insert into accounts (auth_user_id, account_type, client_id)
values ('f5000000-0000-4000-8000-000000000007', 'client', 'f5c00000-0000-4000-8000-00000000000a');

insert into packages (id, name, default_price, description, included_hours)
values ('f5b00000-0000-4000-8000-000000000001', 'FS Test Package', 2000, 'Pkg description', 5);
insert into addons (id, name, default_price, description)
values ('f5ad0000-0000-4000-8000-000000000001', 'FS Test Addon', 300, 'Addon description');
insert into venues (id, name, travel_fee, setup_fee) values ('f5f00000-0000-4000-8000-000000000001', 'FS Test Venue', 75, 50);

insert into events (id, name, event_date, client_id, package_id, package_price_override, travel_fee, deposit_value, venue_id) values
  ('f5a00000-0000-4000-8000-00000000000a', 'FS Test A', current_date + 30, 'f5c00000-0000-4000-8000-00000000000a', 'f5b00000-0000-4000-8000-000000000001', 1000, 75, 250, 'f5f00000-0000-4000-8000-000000000001'),
  ('f5a00000-0000-4000-8000-00000000000b', 'FS Test B', current_date + 31, 'f5c00000-0000-4000-8000-00000000000b', 'f5b00000-0000-4000-8000-000000000001', 1100, 0, 250, null),
  ('f5a00000-0000-4000-8000-00000000000c', 'FS Test C', current_date + 32, 'f5c00000-0000-4000-8000-00000000000c', 'f5b00000-0000-4000-8000-000000000001', 1200, 0, 250, null);

insert into event_addons (id, event_id, addon_id, quantity, price_override) values
  ('f5ae0000-0000-4000-8000-00000000000a', 'f5a00000-0000-4000-8000-00000000000a', 'f5ad0000-0000-4000-8000-000000000001', 2, 300),
  ('f5ae0000-0000-4000-8000-00000000000c', 'f5a00000-0000-4000-8000-00000000000c', 'f5ad0000-0000-4000-8000-000000000001', 1, 300);

insert into payments (event_id, amount, status) values
  ('f5a00000-0000-4000-8000-00000000000a', 500, 'approved'),
  ('f5a00000-0000-4000-8000-00000000000c', 600, 'approved');

insert into event_staff (id, event_id, employee_id, role, pay_type, flat_wage) values
  ('f5d00000-0000-4000-8000-0000000000a4', 'f5a00000-0000-4000-8000-00000000000a', 'f5e00000-0000-4000-8000-000000000004', 'DJ', 'flat', 150),
  ('f5d00000-0000-4000-8000-0000000000b4', 'f5a00000-0000-4000-8000-00000000000b', 'f5e00000-0000-4000-8000-000000000004', 'Setup / Takedown', 'flat', 80),
  ('f5d00000-0000-4000-8000-0000000000a9', 'f5a00000-0000-4000-8000-00000000000a', 'f5e00000-0000-4000-8000-000000000009', 'MC', 'flat', 999),
  ('f5d00000-0000-4000-8000-0000000000c9', 'f5a00000-0000-4000-8000-00000000000c', 'f5e00000-0000-4000-8000-000000000009', 'DJ', 'flat', 777);

insert into event_app_members (event_id, auth_user_id, role)
values ('f5a00000-0000-4000-8000-00000000000a', 'f5000000-0000-4000-8000-000000000008', 'guest');

insert into documents (event_id, title, status) values
  ('f5a00000-0000-4000-8000-00000000000a', 'FS Booking Agreement A', 'draft');

insert into file_label_definitions (name, slug)
select 'Timeline', 'timeline' where not exists (select 1 from file_label_definitions where slug = 'timeline');

insert into storage.buckets (id, name) values ('event-files', 'event-files') on conflict (id) do nothing;
insert into event_files (event_id, name, path, source, label_id) values
  ('f5a00000-0000-4000-8000-00000000000a', 'timeline.pdf', 'f5a00000-0000-4000-8000-00000000000a/fs-timeline.pdf', 'upload',
     (select id from file_label_definitions where slug = 'timeline' order by created_at limit 1)),
  ('f5a00000-0000-4000-8000-00000000000a', 'planner.pdf', 'f5a00000-0000-4000-8000-00000000000a/fs-planner.pdf', 'planner_timeline', null),
  ('f5a00000-0000-4000-8000-00000000000a', 'contract.pdf', 'f5a00000-0000-4000-8000-00000000000a/fs-contract.pdf', 'upload', null),
  ('f5a00000-0000-4000-8000-00000000000c', 'timeline.pdf', 'f5a00000-0000-4000-8000-00000000000c/fs-timeline.pdf', 'upload',
     (select id from file_label_definitions where slug = 'timeline' order by created_at limit 1));
insert into storage.objects (bucket_id, name)
select 'event-files', path from event_files where path like 'f5a00000-%/fs-%';

insert into hl_conversations (id, client_id, phone, contact_name) values
  ('fs-test-conv-a', 'f5c00000-0000-4000-8000-00000000000a', '+15550100001', 'Client A'),
  ('fs-test-conv-b', 'f5c00000-0000-4000-8000-00000000000b', '+15550100002', 'Client B'),
  ('fs-test-conv-c', 'f5c00000-0000-4000-8000-00000000000c', '+15550100003', 'Client C');
insert into hl_messages (id, conversation_id, body) values
  ('fs-test-msg-a', 'fs-test-conv-a', 'hi A'),
  ('fs-test-msg-b', 'fs-test-conv-b', 'hi B'),
  ('fs-test-msg-c', 'fs-test-conv-c', 'hi C');

insert into event_notes (event_id, body) values
  ('f5a00000-0000-4000-8000-00000000000a', 'note A'),
  ('f5a00000-0000-4000-8000-00000000000c', 'note C');

-- ───────────── office: master_admin / admin / salesperson ─────────────
do $office$
declare p record;
begin
  for p in select * from (values
    ('master_admin', 'f5000000-0000-4000-8000-000000000001'),
    ('admin',        'f5000000-0000-4000-8000-000000000002'),
    ('salesperson',  'f5000000-0000-4000-8000-000000000003')) v(name, uid)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into _r (persona, check_name, ok) values
      (p.name, 'events A and C (base table)',
        (select count(*) = 2 from events where id in ('f5a00000-0000-4000-8000-00000000000a', 'f5a00000-0000-4000-8000-00000000000c'))),
      (p.name, 'xos_fs_events A and C (unfiltered)',
        (select count(*) = 2 from xos_fs_events where id in ('f5a00000-0000-4000-8000-00000000000a', 'f5a00000-0000-4000-8000-00000000000c'))),
      (p.name, 'payments visible',
        (select count(*) = 2 from payments where event_id in ('f5a00000-0000-4000-8000-00000000000a', 'f5a00000-0000-4000-8000-00000000000c'))),
      (p.name, 'packages + addons + event_addons visible',
        (select count(*) = 1 from packages where id = 'f5b00000-0000-4000-8000-000000000001')
        and (select count(*) = 1 from addons where id = 'f5ad0000-0000-4000-8000-000000000001')
        and (select count(*) = 2 from event_addons where id::text like 'f5ae0000-%')),
      (p.name, 'documents visible',
        (select count(*) = 1 from documents where event_id = 'f5a00000-0000-4000-8000-00000000000a')),
      (p.name, 'every flat_wage visible in xos_fs_event_staff',
        (select count(*) = 4 from xos_fs_event_staff where id::text like 'f5d00000-%' and flat_wage is not null)),
      (p.name, 'all event files + storage objects',
        (select count(*) = 4 from event_files where path like 'f5a00000-%/fs-%')
        and (select count(*) = 4 from storage.objects where bucket_id = 'event-files' and name like 'f5a00000-%/fs-%')),
      (p.name, 'conversations A/B/C',
        (select count(*) = 3 from hl_conversations where id like 'fs-test-conv-%')),
      (p.name, 'render_merge_tags fills money',
        (select render_merge_tags('f5a00000-0000-4000-8000-00000000000a', '<total_fee>|<event_name>') ~ '^[^|]+\|FS Test A$'));
    reset role;
  end loop;
end
$office$;

-- ───────────── employee (DJ on A, Setup on B, nothing on C) ─────────────
select set_config('request.jwt.claims', json_build_object('sub', 'f5000000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;

insert into _r (persona, check_name, ok) values
  ('employee', 'helpers: field staff, not sees_all, assigned A not C',
    xos_is_field_staff() and not xos_sees_all_events()
    and xos_is_assigned('f5a00000-0000-4000-8000-00000000000a')
    and not xos_is_assigned('f5a00000-0000-4000-8000-00000000000c')),
  ('employee', 'xos_can_access_event A yes / C no',
    xos_can_access_event('f5a00000-0000-4000-8000-00000000000a')
    and not xos_can_access_event('f5a00000-0000-4000-8000-00000000000c')),
  ('employee', 'events base table denied (A and C)',
    (select count(*) = 0 from events where id::text like 'f5a00000-%')),
  ('employee', 'xos_fs_events: A and B, not C',
    (select count(*) = 2 from xos_fs_events where id::text like 'f5a00000-%')
    and not exists (select 1 from xos_fs_events where id = 'f5a00000-0000-4000-8000-00000000000c')),
  ('employee', 'payments denied',
    (select count(*) = 0 from payments where event_id::text like 'f5a00000-%')),
  ('employee', 'packages / addons / event_addons base tables denied',
    (select count(*) = 0 from packages where id = 'f5b00000-0000-4000-8000-000000000001')
    and (select count(*) = 0 from addons where id = 'f5ad0000-0000-4000-8000-000000000001')
    and (select count(*) = 0 from event_addons where id::text like 'f5ae0000-%')),
  ('employee', 'venues base table denied',
    (select count(*) = 0 from venues where id = 'f5f00000-0000-4000-8000-000000000001')),
  ('employee', 'xos_fs_packages / xos_fs_venues readable (no fee columns)',
    (select count(*) = 1 from xos_fs_packages where id = 'f5b00000-0000-4000-8000-000000000001')
    and (select count(*) = 1 from xos_fs_venues where id = 'f5f00000-0000-4000-8000-000000000001')),
  ('employee', 'xos_fs_event_addons: A only, with name + description',
    (select count(*) = 1 from xos_fs_event_addons where id::text like 'f5ae0000-%')
    and (select name = 'FS Test Addon' and description = 'Addon description' and quantity = 2
           from xos_fs_event_addons where id = 'f5ae0000-0000-4000-8000-00000000000a')),
  ('employee', 'documents denied',
    (select count(*) = 0 from documents where event_id::text like 'f5a00000-%')),
  ('employee', 'own wage visible (A=150, B=80)',
    (select flat_wage = 150 from xos_fs_event_staff where id = 'f5d00000-0000-4000-8000-0000000000a4')
    and (select flat_wage = 80 from xos_fs_event_staff where id = 'f5d00000-0000-4000-8000-0000000000b4')),
  ('employee', 'co-worker row on A visible, wage NULL',
    (select flat_wage is null and first_name = 'Other' from xos_fs_event_staff where id = 'f5d00000-0000-4000-8000-0000000000a9')),
  ('employee', 'staff rows of unassigned C hidden',
    not exists (select 1 from xos_fs_event_staff where id = 'f5d00000-0000-4000-8000-0000000000c9')),
  ('employee', 'event_staff base table: own rows only',
    (select count(*) = 2 from event_staff where id::text like 'f5d00000-%')
    and not exists (select 1 from event_staff where employee_id = 'f5e00000-0000-4000-8000-000000000009')),
  ('employee', 'employees base table: own row only',
    (select count(*) = 1 from employees where id::text like 'f5e00000-%')),
  ('employee', 'xos_fs_employees lists co-workers by name',
    (select count(*) = 7 from xos_fs_employees where id::text like 'f5e00000-%')),
  ('employee', 'event_files: timeline + planner on A only (no contract, nothing on C)',
    (select count(*) = 2 from event_files where path like 'f5a00000-%/fs-%')
    and not exists (select 1 from event_files where path like '%/fs-contract.pdf')),
  ('employee', 'storage: timeline + planner on A only',
    (select count(*) = 2 from storage.objects where bucket_id = 'event-files' and name like 'f5a00000-%/fs-%')
    and not exists (select 1 from storage.objects where name like '%/fs-contract.pdf')),
  ('employee', 'clients: A and B (assigned), not C',
    (select count(*) = 2 from clients where id::text like 'f5c00000-%')
    and not exists (select 1 from clients where id = 'f5c00000-0000-4000-8000-00000000000c')),
  ('employee', 'conversations: A (DJ) only — not B (Setup role), not C',
    (select count(*) = 1 from hl_conversations where id like 'fs-test-conv-%')
    and exists (select 1 from hl_conversations where id = 'fs-test-conv-a')),
  ('employee', 'messages: A only',
    (select count(*) = 1 from hl_messages where id like 'fs-test-msg-%')),
  ('employee', 'render_merge_tags A: money blank, name kept',
    render_merge_tags('f5a00000-0000-4000-8000-00000000000a', '<total_fee>|<event_name>') = '|FS Test A'),
  ('employee', 'render_merge_tags C (unassigned): empty',
    render_merge_tags('f5a00000-0000-4000-8000-00000000000c', '<total_fee>|<event_name>') = ''),
  ('employee', 'event_notes: A visible, C hidden',
    (select count(*) = 1 from event_notes where event_id::text like 'f5a00000-%')
    and exists (select 1 from event_notes where event_id = 'f5a00000-0000-4000-8000-00000000000a'));

-- writes
do $w$
declare n int;
begin
  -- own check-in stamp: allowed
  begin
    update event_staff set checked_in_at = now() where id = 'f5d00000-0000-4000-8000-0000000000a4';
    get diagnostics n = row_count;
    insert into _r (persona, check_name, ok) values ('employee', 'write: own checked_in_at OK', n = 1);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: own checked_in_at OK (' || sqlerrm || ')', false);
  end;
  -- own wage: blocked by the guard trigger
  begin
    update event_staff set flat_wage = 9999 where id = 'f5d00000-0000-4000-8000-0000000000a4';
    insert into _r (persona, check_name, ok) values ('employee', 'write: own flat_wage blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: own flat_wage blocked', true);
  end;
  -- co-worker's row: hidden by RLS (0 rows) or blocked by the trigger
  begin
    update event_staff set checked_in_at = now() where id = 'f5d00000-0000-4000-8000-0000000000a9';
    get diagnostics n = row_count;
    insert into _r (persona, check_name, ok) values ('employee', 'write: co-worker row blocked', n = 0);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: co-worker row blocked', true);
  end;
  -- assignment insert: blocked
  begin
    insert into event_staff (event_id, employee_id, role) values ('f5a00000-0000-4000-8000-00000000000c', 'f5e00000-0000-4000-8000-000000000004', 'DJ');
    insert into _r (persona, check_name, ok) values ('employee', 'write: self-assign to C blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: self-assign to C blocked', true);
  end;
  -- events: 0 rows
  begin
    update events set name = 'hacked' where id = 'f5a00000-0000-4000-8000-00000000000a';
    get diagnostics n = row_count;
    insert into _r (persona, check_name, ok) values ('employee', 'write: events update affects 0 rows', n = 0);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: events update affects 0 rows', true);
  end;
  -- event_notes on A: allowed
  begin
    insert into event_notes (event_id, body) values ('f5a00000-0000-4000-8000-00000000000a', 'employee note A');
    insert into _r (persona, check_name, ok) values ('employee', 'write: event_notes insert on A OK', true);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: event_notes insert on A OK (' || sqlerrm || ')', false);
  end;
  -- event_notes on C: blocked
  begin
    insert into event_notes (event_id, body) values ('f5a00000-0000-4000-8000-00000000000c', 'employee note C');
    insert into _r (persona, check_name, ok) values ('employee', 'write: event_notes insert on C blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: event_notes insert on C blocked', true);
  end;
  -- own tier: blocked
  begin
    update employees set permission_tier = 'master_admin' where id = 'f5e00000-0000-4000-8000-000000000004';
    insert into _r (persona, check_name, ok) values ('employee', 'write: own permission_tier blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: own permission_tier blocked', true);
  end;
  -- own profile field: allowed
  begin
    update employees set bio = 'hello' where id = 'f5e00000-0000-4000-8000-000000000004';
    get diagnostics n = row_count;
    insert into _r (persona, check_name, ok) values ('employee', 'write: own bio OK', n = 1);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: own bio OK (' || sqlerrm || ')', false);
  end;
  -- role grid: blocked
  begin
    insert into role_permissions (role, module, access) values ('employee', 'fs_test_module', 'edit');
    insert into _r (persona, check_name, ok) values ('employee', 'write: role_permissions insert blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: role_permissions insert blocked', true);
  end;
  begin
    update role_permissions set access = 'edit' where role = 'employee';
    get diagnostics n = row_count;
    insert into _r (persona, check_name, ok) values ('employee', 'write: role_permissions update blocked', n = 0);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: role_permissions update blocked', true);
  end;
  -- payments insert: blocked
  begin
    insert into payments (event_id, amount, status) values ('f5a00000-0000-4000-8000-00000000000a', 1, 'pending');
    insert into _r (persona, check_name, ok) values ('employee', 'write: payments insert blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: payments insert blocked', true);
  end;
  -- sms to DJ client A: allowed; to C: blocked
  begin
    insert into sms_log (client_id, to_number, body) values ('f5c00000-0000-4000-8000-00000000000a', '+15550100001', 'fs test');
    insert into _r (persona, check_name, ok) values ('employee', 'write: sms_log to DJ client A OK', true);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: sms_log to DJ client A OK (' || sqlerrm || ')', false);
  end;
  begin
    insert into sms_log (client_id, to_number, body) values ('f5c00000-0000-4000-8000-00000000000c', '+15550100003', 'fs test');
    insert into _r (persona, check_name, ok) values ('employee', 'write: sms_log to client C blocked', false);
  exception when others then
    insert into _r (persona, check_name, ok) values ('employee', 'write: sms_log to client C blocked', true);
  end;
end
$w$;
reset role;

-- ───────────── marketing + accounts-linked employee (no assignments) ─────────────
do $fs$
declare p record;
begin
  for p in select * from (values
    ('marketing', 'f5000000-0000-4000-8000-000000000005'),
    ('accounts_linked_employee', 'f5000000-0000-4000-8000-000000000006')) v(name, uid)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', p.uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into _r (persona, check_name, ok) values
      (p.name, 'is field staff', xos_is_field_staff()),
      (p.name, 'no events (base or view)',
        (select count(*) = 0 from events where id::text like 'f5a00000-%')
        and (select count(*) = 0 from xos_fs_events where id::text like 'f5a00000-%')),
      (p.name, 'no payments / packages / documents',
        (select count(*) = 0 from payments where event_id::text like 'f5a00000-%')
        and (select count(*) = 0 from packages where id = 'f5b00000-0000-4000-8000-000000000001')
        and (select count(*) = 0 from documents where event_id::text like 'f5a00000-%')),
      (p.name, 'no conversations, no files',
        (select count(*) = 0 from hl_conversations where id like 'fs-test-conv-%')
        and (select count(*) = 0 from storage.objects where name like 'f5a00000-%/fs-%'));
    reset role;
  end loop;
end
$fs$;

-- ───────────── client of A (unchanged behaviour) ─────────────
select set_config('request.jwt.claims', json_build_object('sub', 'f5000000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r (persona, check_name, ok) values
  ('client', 'not field staff, sees_all true (restrictive policies no-op)',
    not xos_is_field_staff() and xos_sees_all_events()),
  ('client', 'own event A visible, C not',
    exists (select 1 from events where id = 'f5a00000-0000-4000-8000-00000000000a')
    and not exists (select 1 from events where id = 'f5a00000-0000-4000-8000-00000000000c')),
  ('client', 'own payments still visible',
    (select count(*) = 1 from payments where event_id::text like 'f5a00000-%')),
  ('client', 'staff views return nothing',
    (select count(*) = 0 from xos_fs_events) and (select count(*) = 0 from xos_fs_event_staff)
    and (select count(*) = 0 from xos_fs_venues) and (select count(*) = 0 from xos_fs_employees)),
  ('client', 'storage: all files of own event A, none of C',
    (select count(*) = 3 from storage.objects where name like 'f5a00000-0000-4000-8000-00000000000a/fs-%')
    and (select count(*) = 0 from storage.objects where name like 'f5a00000-0000-4000-8000-00000000000c/fs-%')),
  ('client', 'render_merge_tags A fills money',
    render_merge_tags('f5a00000-0000-4000-8000-00000000000a', '<total_fee>|<event_name>') ~ '^[^|]+\|FS Test A$');
reset role;

-- ───────────── guest of A (unchanged behaviour) ─────────────
select set_config('request.jwt.claims', json_build_object('sub', 'f5000000-0000-4000-8000-000000000008', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r (persona, check_name, ok) values
  ('guest', 'can access A, not C',
    xos_can_access_event('f5a00000-0000-4000-8000-00000000000a')
    and not xos_can_access_event('f5a00000-0000-4000-8000-00000000000c')),
  ('guest', 'no events rows, no views, no payments',
    (select count(*) = 0 from events where id::text like 'f5a00000-%')
    and (select count(*) = 0 from xos_fs_events)
    and (select count(*) = 0 from payments where event_id::text like 'f5a00000-%'));
reset role;

-- ───────────── anon ─────────────
select set_config('request.jwt.claims', '', true);
set local role anon;
do $anon$
begin
  begin
    perform 1 from xos_fs_events limit 1;
    insert into _r (persona, check_name, ok) values ('anon', 'xos_fs_events not readable', false);
  exception when insufficient_privilege then
    insert into _r (persona, check_name, ok) values ('anon', 'xos_fs_events not readable', true);
  end;
  begin
    perform 1 from xos_fs_event_staff limit 1;
    insert into _r (persona, check_name, ok) values ('anon', 'xos_fs_event_staff not readable', false);
  exception when insufficient_privilege then
    insert into _r (persona, check_name, ok) values ('anon', 'xos_fs_event_staff not readable', true);
  end;
  begin
    perform public.xos_dj_client_ids();
    insert into _r (persona, check_name, ok) values ('anon', 'helpers not executable', false);
  exception when insufficient_privilege then
    insert into _r (persona, check_name, ok) values ('anon', 'helpers not executable', true);
  end;
end
$anon$;
reset role;

-- ───────────── results ─────────────
select seq, persona, check_name, case when ok then 'PASS' else 'FAIL' end as result
from _r
union all
select 9999, '—', format('%s checks, %s failed', count(*), count(*) filter (where ok is not true)),
       case when bool_and(coalesce(ok, false)) then 'ALL PASS' else 'FAILURES' end
from _r
order by 1;

rollback;
