-- Persist the e-signature consent-to-electronic-records affirmation with each
-- signed document: whether the box was checked (always true to reach signing) and
-- which disclosure version + exact text the signer agreed to. Strengthens the
-- ESIGN/UETA trail — previously the consent gate was required but never recorded.
alter table public.documents
  add column if not exists consent_given boolean,
  add column if not exists consent_disclosure_version text,
  add column if not exists consent_disclosure_text text;
