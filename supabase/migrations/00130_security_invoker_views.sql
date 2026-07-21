-- Supabase's security advisor flags both views created in 00084 as ERROR
-- (0010_security_definer_view): a view without security_invoker runs as its
-- owner (postgres) and ignores the querying user's RLS, so it can return rows
-- the caller shouldn't see. Fix both:
--
--   * event_staff_public — has NO consumer in any app (xos / xpress-client /
--     xos-mobile); it was created for a portal feature that the in-house planner
--     replaced. DROP it.
--
--   * company_public — still read by the xpress-client app (account.ts) for the
--     company identity shown on the Account tab. It must keep exposing ONLY the
--     three public fields (company_name / from_email / reply_to — all of which
--     already appear on every email a client receives) WITHOUT exposing the rest
--     of company_settings (email send windows, notification prefs, default
--     template id, …). company_settings stays fully staff-only under RLS.
--
--     We can't simply flip the view to security_invoker and add a client read
--     policy on company_settings: RLS is row-level, not column-level, and staff
--     + clients share the `authenticated` role, so column GRANTs can't separate
--     them. Instead the curated read goes through a SECURITY DEFINER *function*
--     (the advisor's 0010 rule targets views, not functions — the codebase
--     already relies on definer functions like xos_is_staff()). The view then
--     becomes a thin security_invoker wrapper over that function, so it is no
--     longer flagged and clients never touch the base table.
--
-- Safe to re-run.

-- 1) Unused, per-row-risk view → gone.
drop view if exists public.event_staff_public;

-- 2) Curated definer accessor for the singleton company identity.
create or replace function public.company_public_info()
returns table (company_name text, from_email text, reply_to text)
language sql
stable
security definer
set search_path = public
as $$
  select company_name, from_email, reply_to
  from company_settings
  where id = true;
$$;

revoke all on function public.company_public_info() from public;
grant execute on function public.company_public_info() to anon, authenticated;

-- 3) Recreate company_public as a security_invoker view over the function. Same
--    name and columns, so the client app needs no change.
drop view if exists public.company_public;
create view public.company_public
  with (security_invoker = true)
  as select company_name, from_email, reply_to
     from public.company_public_info();
grant select on public.company_public to anon, authenticated;
