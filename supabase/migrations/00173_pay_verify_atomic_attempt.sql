-- Atomic pay-OTP attempt counter. The app did read -> check attempts < 6 ->
-- increment as three steps (TOCTOU): parallel requests all read the same count,
-- all pass the check, and all increment, exceeding the cap. This increments in a
-- single statement only while the challenge is open and under the limit, and
-- returns the new count (NULL when it didn't qualify -> over-limit / consumed /
-- expired). Callers treat NULL as over-limit.
create or replace function public.pay_verify_attempt(p_id uuid, p_max int)
 returns int
 language sql
 security definer
 set search_path to 'public'
as $function$
  update pay_verifications
     set attempts = attempts + 1
   where id = p_id
     and attempts < p_max
     and consumed_at is null
     and expires_at > now()
  returning attempts;
$function$;

-- service-role only (the pay routes call via the admin client); pay_verifications
-- is RLS-locked with no policies, so anon/authenticated must not execute this.
revoke execute on function public.pay_verify_attempt(uuid, int) from public, anon, authenticated;
grant execute on function public.pay_verify_attempt(uuid, int) to service_role;
