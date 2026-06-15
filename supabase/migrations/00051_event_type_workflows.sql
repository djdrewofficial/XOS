-- XOS — Event-Type Workflows: the /proposal confirm flow varies per event type.
-- Each type can override the global default; null = inherit. Office (not the
-- client) controls payment terms on types where payment_chooser = 'office'.

-- ============ per-event-type overrides ============
alter table event_types add column if not exists proposal_doc_template_id uuid references document_templates(id);
-- layout of the /proposal page: 'couple' (Partner A + Partner B) or 'business'
-- (Organization + a single billing/signer contact). null = inherit global.
alter table event_types add column if not exists proposal_layout text
  check (proposal_layout in ('couple','business'));
-- who decides the payment plan: 'client' (couple picks) or 'office' (we set it).
alter table event_types add column if not exists payment_chooser text
  check (payment_chooser in ('client','office'));

-- ============ global defaults (journey_settings) ============
alter table journey_settings add column if not exists proposal_layout text not null default 'couple'
  check (proposal_layout in ('couple','business'));
alter table journey_settings add column if not exists payment_chooser text not null default 'client'
  check (payment_chooser in ('client','office'));

-- ============ office-set billing terms (per event) ============
-- used when the resolved payment_chooser = 'office'
alter table events add column if not exists billing_terms text
  check (billing_terms in ('up_front','net_30','installments'));
alter table events add column if not exists billing_terms_count int not null default 2;
