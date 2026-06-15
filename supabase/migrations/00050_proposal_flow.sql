-- XOS — Client Journey reorder (Phase 2): the "Review & Sign" button now lands
-- the couple on a /proposal/[pay_token] page where they confirm/edit their
-- details and pick a payment plan; the contract is generated AFTER that, then
-- they sign. Autopay consent is captured here too (charging machinery: Phase 3).

-- ============ proposal/confirm flow config (journey_settings) ============
-- master switch — when on, the quote email's e-sign button points to /proposal
-- (collect + confirm first) instead of generating the doc and going to /sign.
alter table journey_settings add column if not exists proposal_flow_enabled boolean not null default true;
-- which document template the /proposal page generates once the couple confirms
alter table journey_settings add column if not exists proposal_doc_template_id uuid references document_templates(id);

-- default to the seeded Booking Agreement template if it exists
update journey_settings
  set proposal_doc_template_id = 'e2ae8026-0d1a-4681-be90-f130d572aec4'
  where proposal_doc_template_id is null
    and exists (select 1 from document_templates where id = 'e2ae8026-0d1a-4681-be90-f130d572aec4');

-- ============ autopay consent (Phase 3 adds the PayPal vault + charge cron) ============
alter table events add column if not exists autopay_enabled boolean not null default false;
alter table events add column if not exists autopay_consent_at timestamptz;
alter table events add column if not exists autopay_consent_ip text;
alter table events add column if not exists autopay_consent_ua text;
alter table events add column if not exists autopay_consent_name text;
