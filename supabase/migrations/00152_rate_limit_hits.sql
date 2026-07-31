-- Generic rate-limit ledger: one row per throttled action ("hit"), grouped by a
-- (bucket, key) pair — e.g. bucket='pwreset:email' key=<email>, or
-- bucket='pwreset:ip' key=<ip>. A limiter counts recent rows in a time window.
-- First use: throttle the public mobile forgot-password endpoint (email bombing).
--
-- Written and read only by the service-role client (createAdminClient), which
-- bypasses RLS; the "staff only" policy just denies every normal login, keeping
-- the table off the "RLS enabled, no policy" advisor and out of client reach.

create table if not exists rate_limit_hits (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  key        text not null,
  created_at timestamptz not null default now()
);

-- The limiter always filters by (bucket, key) over a recent created_at window.
create index if not exists rate_limit_hits_lookup_idx
  on rate_limit_hits (bucket, key, created_at desc);

alter table rate_limit_hits enable row level security;
drop policy if exists "staff only" on rate_limit_hits;
create policy "staff only" on rate_limit_hits
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
