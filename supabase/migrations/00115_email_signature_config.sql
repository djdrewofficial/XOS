-- Structured config for the email-signature builder (Settings → Email).
-- The UI edits this JSON (logo size, alignment, which contact fields to show);
-- saveEmailSignature() generates email_signature_html from it, which is what the
-- <company_email_signature> merge tag resolves to at send time.
alter table company_settings
  add column if not exists email_signature_config jsonb;
