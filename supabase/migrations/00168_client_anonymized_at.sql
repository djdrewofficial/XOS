-- Support an in-product "delete my data" (GDPR/CCPA right-to-erasure) request via
-- anonymization: staff scrub a client's PII in place but KEEP the row so their
-- events and payment history stay attributable (financial records are retained
-- under a separate legal basis). anonymized_at records when it happened and marks
-- the row so the UI reflects the erased state.
alter table public.clients
  add column if not exists anonymized_at timestamptz;
