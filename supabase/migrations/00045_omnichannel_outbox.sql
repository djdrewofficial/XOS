-- XOS — omnichannel outbox: the comms hub replies on any GHL channel
-- (SMS, Email, WhatsApp, Instagram, Facebook, Google Business), not just SMS.
-- sms_log generalizes: channel column, email subject, and the GHL contact id
-- so channel replies (IG/FB have no phone number) resolve without a lookup.

alter table sms_log alter column to_number drop not null;
alter table sms_log add column if not exists channel text not null default 'SMS'
  check (channel in ('SMS','Email','WhatsApp','IG','FB','GMB'));
alter table sms_log add column if not exists subject text;          -- Email only
alter table sms_log add column if not exists to_address text;       -- Email recipient
alter table sms_log add column if not exists hl_target_contact_id text; -- reply target (skips phone upsert)
