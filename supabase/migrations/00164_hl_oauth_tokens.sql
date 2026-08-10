-- HighLevel Marketplace-App OAuth tokens (for native outbound-email threading).
--
-- XOS talks to GHL with a Private Integration Token for most calls, but logging
-- an outbound email into a GHL conversation WITHOUT re-sending it goes through a
-- GHL Conversation Provider, which only exists on a Marketplace App and must be
-- called with that app's OAuth 2.0 access token. This table holds the per-location
-- OAuth tokens minted when the app is installed on the sub-account.
--
-- Single-tenant today, but keyed by location_id so it's correct if XOS ever runs
-- multi-location. Tokens are secrets: RLS is enabled with NO policies, so only the
-- service-role admin client (which bypasses RLS) can read/write them. No client,
-- authenticated, or anon role can touch this table.

create table if not exists hl_oauth_tokens (
  location_id   text primary key,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scope         text,
  company_id    text,
  hl_user_id    text,
  updated_at    timestamptz not null default now()
);

alter table hl_oauth_tokens enable row level security;
-- Intentionally no policies: service-role only.
