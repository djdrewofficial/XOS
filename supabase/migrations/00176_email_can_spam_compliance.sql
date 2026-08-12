-- CAN-SPAM compliance for commercial (marketing) email: physical postal address,
-- one-click unsubscribe, and an email suppression list mirroring sms_opt_outs.
--
-- The branded footer was the company name only — no unsubscribe, no postal address.
-- Drip proposal-reminder mail is commercial email under CAN-SPAM (statutory exposure
-- + deliverability damage). This adds the data model; the send pipeline (processOutbox)
-- renders the footer, honors the suppression list, and sets List-Unsubscribe headers.

-- 1) Email suppression (unsubscribe) list — mirror of sms_opt_outs (the TCPA STOP
--    list). Keyed by lowercased email; opted_out=true suppresses MARKETING mail,
--    false = explicit re-subscribe, no row = subscribed. Transactional mail
--    (agreements, receipts, invites, reminders) is never suppressed.
create table if not exists public.email_opt_outs (
  email      text primary key,
  opted_out  boolean not null default true,
  source     text,
  reason     text,
  signal_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Service-role / owner only (the outbox drainer + unsubscribe route use the admin
-- client) — no anon/authenticated policies, same posture as sms_opt_outs.
alter table public.email_opt_outs enable row level security;

-- 2) Marketing classification on email templates. Commercial/drip mail (proposal
--    reminders, promos) = true → gets the unsubscribe link + List-Unsubscribe header
--    and is suppressed for opted-out recipients. Default false so transactional mail
--    (agreements, receipts, invites) is never gated or suppressed.
alter table public.email_templates add column if not exists is_marketing boolean not null default false;

-- 3) Physical mailing address for the CAN-SPAM footer (shown on all automated mail).
alter table public.company_settings add column if not exists postal_address text;
