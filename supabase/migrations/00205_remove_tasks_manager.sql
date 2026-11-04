-- Remove Tasks Manager.
--
-- STOP. This migration destroys live task data and cannot be undone from this
-- file. Do not apply it until the owner confirms. As of the audit that wrote
-- this file the live database held:
--   * 1 task ("Test Task for Laura")
--   * 8 task rules (1 active: "Ensure DJ Client Communication 30 Days Before Event")
--   * 4 task comments
--   * 1 bell notification of type staff_task
--   * role_permissions rows for module 'tasks' (admin/salesperson edit, employee view,
--     marketing none)
--   * pg_cron job 'xos-task-rules' (daily, 30 9 * * *)
-- No booking helper, email template, landing page, or employee permission override
-- referenced the feature. Booking-helper action types are unchanged: none of them
-- create tasks.
--
-- Order: cron job, then any triggers on the task tables, then the tables, then
-- the task-only pieces of shared tables.

-- ---- 1. Cron. Unschedule before the route it calls disappears. ----------------
do $$ begin
  perform cron.unschedule('xos-task-rules');
exception when others then null;
end $$;

-- ---- 2. Triggers. None are created by the migrations; drop any that exist. ----
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('tasks', 'task_rules', 'task_comments')
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on %I.%I', r.tgname, r.nspname, r.relname);
  end loop;
end $$;

-- ---- 3. Shared-table link that would block dropping tasks. --------------------
-- Fireflies suggestions keep their own approve/dismiss status. This column only
-- pointed at a Tasks Manager row created on approve.
alter table public.fireflies_suggested_tasks drop column if exists task_id;

-- ---- 4. Task-only tables (dependents first). Policies and indexes go with them.
drop table if exists public.task_comments;
drop table if exists public.tasks;
drop table if exists public.task_rules;

-- ---- 5. Task-only rows in shared tables. --------------------------------------
delete from public.role_permissions where module = 'tasks';
delete from public.employee_permissions where module = 'tasks';

-- Bell rows created for assignments and @mentions. staff_task is not a catalog
-- type in notification_types; it was only written by the task notifier.
delete from public.notifications
 where type = 'staff_task'
    or coalesce(href, '') like '/tasks%';

-- Nobody was landing on /tasks at audit time. Reset anyway so a later save
-- cannot send someone to a page that no longer exists.
update public.company_settings
   set landing_page = '/'
 where landing_page like '/tasks%';

update public.role_settings
   set landing_page = '/'
 where landing_page like '/tasks%';

update public.employees
   set landing_page = null
 where landing_page like '/tasks%';
