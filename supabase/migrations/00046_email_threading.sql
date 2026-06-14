-- XOS — email replies continue the existing email chain (GHL replyMessageId)
-- instead of starting a new one.
alter table sms_log add column if not exists reply_to_message_id text;
