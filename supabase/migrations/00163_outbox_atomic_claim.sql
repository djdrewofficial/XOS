-- CRITICAL go-live fix: outbox drainers could double-send.
--
-- processOutbox (email_log) and processSmsOutbox (sms_log) both did:
--   select ... where status='queued'  ->  call provider  ->  update status='sent'
-- The row stayed status='queued' for the entire provider round-trip, and the
-- drainers fire from ~38 inline call sites + a 10-min cron + the mobile drain.
-- Two overlapping drains (e.g. a PayPal payment landing as the cron fires) both
-- select the same queued row and both send it -- the client gets the same
-- receipt/contract/text twice. A provider-accepted-but-status-write-failed case
-- resends on the next run for the same reason.
--
-- Fix: claim atomically BEFORE sending. A row is flipped queued->sending in one
-- statement under FOR UPDATE SKIP LOCKED, so concurrent claimers get disjoint
-- row sets and a row is only ever sent by the one worker that claimed it. The
-- drainer then flips sending->sent/failed after the provider responds.
--
-- Crash safety: a worker that dies between claim and flip would strand a row in
-- 'sending' forever. The claim functions also reclaim rows left in 'sending'
-- past a stale window (default 15 min, comfortably longer than any real drain
-- and longer than the 10-min cron interval so overlapping crons never reclaim a
-- row that's still being sent), so a stranded receipt eventually goes out.

-- 1. Allow the interim 'sending' state on both logs.
alter table email_log drop constraint if exists email_log_status_check;
alter table email_log add constraint email_log_status_check
  check (status = any (array['queued','sending','sent','delivered','opened','failed','bounced','complained','cancelled']));

alter table sms_log drop constraint if exists sms_log_status_check;
alter table sms_log add constraint sms_log_status_check
  check (status = any (array['queued','sending','sent','failed','cancelled','suppressed']));

-- 2. Track when a row was claimed, so stale in-flight rows can be reclaimed.
alter table email_log add column if not exists claimed_at timestamptz;
alter table sms_log  add column if not exists claimed_at timestamptz;

-- 3. Keep the claim scan cheap: index the rows a drain actually looks at.
create index if not exists email_log_drainable_idx on email_log (created_at)
  where status in ('queued','sending');
create index if not exists sms_log_drainable_idx on sms_log (created_at)
  where status in ('queued','sending');

-- 4. Atomic claim for the email outbox. Flips queued (and stale 'sending') rows
--    to 'sending' and returns exactly the rows this caller now owns.
create or replace function public.claim_email_outbox(p_limit int default 50, p_stale_seconds int default 900)
 returns setof email_log
 language sql
 security definer
 set search_path to 'public'
as $function$
  update email_log e
  set status = 'sending', claimed_at = now()
  where e.id in (
    select id from email_log
    where status = 'queued'
       or (status = 'sending' and claimed_at < now() - make_interval(secs => p_stale_seconds))
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning e.*;
$function$;

-- 5. Atomic claim for the SMS/channel outbox.
create or replace function public.claim_sms_outbox(p_limit int default 50, p_stale_seconds int default 900)
 returns setof sms_log
 language sql
 security definer
 set search_path to 'public'
as $function$
  update sms_log s
  set status = 'sending', claimed_at = now()
  where s.id in (
    select id from sms_log
    where status = 'queued'
       or (status = 'sending' and claimed_at < now() - make_interval(secs => p_stale_seconds))
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning s.*;
$function$;

-- Drains run as the logged-in staff user (inline call sites, mobile JWT) or the
-- service role (cron, public pay/sign flows). Never anon -- keep the mutating
-- claim off the public anon key.
revoke all on function public.claim_email_outbox(int, int) from public, anon;
revoke all on function public.claim_sms_outbox(int, int)   from public, anon;
grant execute on function public.claim_email_outbox(int, int) to authenticated, service_role;
grant execute on function public.claim_sms_outbox(int, int)   to authenticated, service_role;
