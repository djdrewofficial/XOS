-- XOS — per-recipient notification bell (Notification System, phase 5).
-- The bell was a single company-wide feed (migration 00032: SELECT policy
-- "authenticated full access"). Now that the dispatcher targets notifications
-- (target_employee_id / target_roles, migration 00126), scope what each user
-- sees. Legacy untargeted rows (target_* empty) stay broadcast so nothing that
-- worked before disappears.

-- Definer insert used by the app-layer dispatcher (src/lib/notify.ts) so targeted
-- inserts succeed regardless of the acting caller's RLS context (staff action,
-- public sign/proposal token, cron). Gating already happened in the dispatcher.
create or replace function create_targeted_notification(
  p_type text, p_title text, p_body text, p_href text,
  p_target_employee uuid, p_target_roles text[]
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into notifications (type, title, body, href, target_employee_id, target_roles)
  values (p_type, p_title, p_body, p_href, p_target_employee, coalesce(p_target_roles, '{}'));
end;
$$;
revoke execute on function create_targeted_notification(text, text, text, text, uuid, text[]) from anon, public;
grant execute on function create_targeted_notification(text, text, text, text, uuid, text[]) to authenticated, service_role;

-- Visibility: staff only; master admin / owner sees all; everyone sees broadcast
-- (untargeted) rows; otherwise a row must target you or one of your roles.
create or replace function xos_can_see_notification(p_target_employee uuid, p_target_roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select xos_is_staff() and (
    coalesce(xos_current_tier(), 'master_admin') = 'master_admin'
    or (p_target_employee is null and (p_target_roles is null or p_target_roles = '{}'))
    or p_target_employee = xos_current_employee_id()
    or xos_current_tier() = any(coalesce(p_target_roles, '{}'))
  );
$$;
revoke execute on function xos_can_see_notification(uuid, text[]) from anon, public;
grant execute on function xos_can_see_notification(uuid, text[]) to authenticated;

-- Swap the blanket policy for per-recipient SELECT + UPDATE (mark-read).
drop policy if exists "authenticated full access" on notifications;

do $$ begin
  create policy "see own notifications" on notifications
    for select to authenticated
    using (xos_can_see_notification(target_employee_id, target_roles));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "update own notifications" on notifications
    for update to authenticated
    using (xos_can_see_notification(target_employee_id, target_roles))
    with check (xos_can_see_notification(target_employee_id, target_roles));
exception when duplicate_object then null; end $$;
