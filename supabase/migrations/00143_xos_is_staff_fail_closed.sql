-- SECURITY: make xos_is_staff() fail CLOSED.
-- Previously it returned true whenever there was NO client/event_guest accounts
-- row for auth.uid() — i.e. staff was inferred from ABSENCE. Any authenticated
-- session with no accounts row (e.g. a self-signed-up user, if Supabase signups
-- are enabled) was therefore treated as full staff. Now staff is a POSITIVE
-- signal: an accounts row of type 'staff' (the source of truth used by getMe) OR
-- a direct employee login. Unknown/rowless identities get false.
create or replace function public.xos_is_staff()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from accounts a
    where a.auth_user_id = auth.uid()
      and a.account_type = 'staff'
  ) or exists (
    select 1 from employees e
    where e.auth_user_id = auth.uid()
  );
$function$;
