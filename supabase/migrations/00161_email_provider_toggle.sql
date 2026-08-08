-- Choose which provider sends outbound template/outbox emails.
-- 'mailgun'   → direct via Mailgun (design preserved, not logged in HighLevel)
-- 'highlevel' → via HighLevel Conversations API so the email threads into the
--               client's conversation (visible in Comms + HighLevel) while
--               still carrying the full branded HTML. Falls back to Mailgun on
--               a HighLevel send failure so client mail never silently drops.
alter table company_settings
  add column if not exists email_provider text not null default 'mailgun'
  check (email_provider in ('mailgun', 'highlevel'));

-- Switch the live tenant to HighLevel per Drew's request.
update company_settings set email_provider = 'highlevel' where id = true;
