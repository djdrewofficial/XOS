-- Phone-verification gate for the public pay page (/welcome/[token]).
-- Before a client can see the balance or pay, they enter the mobile number on
-- file for the booking and a 6-digit code we text them. Blocks spam/fraud
-- attempts by anyone who doesn't hold the client's phone.

-- Master toggle (default ON). If SMS (HighLevel) isn't configured, the app
-- skips the gate regardless so clients are never locked out.
alter table payment_settings
  add column if not exists require_pay_verification boolean not null default true;

-- One row per code challenge. Written/read only by the service-role admin client
-- used by the public pay endpoints — RLS is on with NO policies, so anon/auth
-- sessions can't touch it.
create table if not exists public.pay_verifications (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  code_hash           text not null,           -- sha256 of the 6-digit code (never store the code)
  phone_last4         text,
  attempts            int  not null default 0,
  expires_at          timestamptz not null,    -- code good for ~10 min
  consumed_at         timestamptz,             -- set once verified (or spent)
  session_token       uuid,                    -- issued on success; matches the pay_sess cookie
  session_expires_at  timestamptz,             -- verified session good for ~45 min
  verified_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists pay_verifications_event_idx
  on public.pay_verifications(event_id, created_at desc);
create index if not exists pay_verifications_session_idx
  on public.pay_verifications(session_token) where session_token is not null;

alter table public.pay_verifications enable row level security;
-- intentionally no policies: only the service-role admin client may access this.
