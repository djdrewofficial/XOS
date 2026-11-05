-- Clear one login's phone without signing in as that person.
--
-- GoTrue's admin updateUserById ignores a blank phone, so a real clear writes
-- auth.users directly. The function is security definer (it has to touch
-- auth.users) with an empty search_path, and only service_role may execute it.
-- The service-role client calls it as rpc('xos_clear_auth_phone', { p_user_id }).
--
-- Returns true when a row changed: that user had a phone or a confirmation
-- timestamp, and both are now null. False means nothing changed (no such
-- login, or the phone was already empty).
--
-- Apply this before the phone-sync code that calls it is deployed. A clear
-- without the function fails softly: the CRM save still succeeds and the
-- profile note says text sign-in could not be updated.

create or replace function public.xos_clear_auth_phone(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  update auth.users
     set phone = null,
         phone_confirmed_at = null
   where id = p_user_id
     and (phone is not null or phone_confirmed_at is not null)
  returning id into v_id;

  return v_id is not null;
end;
$function$;

revoke execute on function public.xos_clear_auth_phone(uuid) from public;
revoke execute on function public.xos_clear_auth_phone(uuid) from anon;
revoke execute on function public.xos_clear_auth_phone(uuid) from authenticated;
grant execute on function public.xos_clear_auth_phone(uuid) to service_role;

comment on function public.xos_clear_auth_phone(uuid) is
  'Null auth.users.phone and phone_confirmed_at for one login. service_role only. True when a row changed.';
