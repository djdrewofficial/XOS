-- XOS — Document Manager (phase 1).
-- Block-based templates (built in the in-app builder, no external HTML), rendered
-- into a branded shell. Generating a document for an event merges tags and freezes
-- the result — template edits never change already-generated documents.
-- Signing columns are included now (phase 2 wires the client link + e-sign flow).

create table if not exists document_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'New Document',
  doc_type text not null default 'contract'
    check (doc_type in ('contract', 'quote', 'invoice', 'other')),
  -- ordered blocks: [{id, type, html?}] — text blocks carry html with merge tags;
  -- smart blocks (fee_table, payment_schedule, event_details, signature, divider)
  -- render from live event data at generation time
  blocks jsonb not null default '[]'::jsonb,
  -- phase 2: where the client is forwarded after signing (blank = default thank-you)
  after_sign_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references document_templates(id) on delete set null,
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  doc_type text not null default 'contract',
  -- frozen snapshot: same block shape but every block's html is fully rendered
  blocks jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'final', 'sent', 'signed', 'void')),
  -- phase 2: client signing
  access_token uuid not null default gen_random_uuid(),
  signer_name text,
  signed_at timestamptz,
  signer_ip text,
  signer_user_agent text,
  doc_hash text,            -- sha-256 of the content at signing (tamper evidence)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_event_idx on documents(event_id);
create unique index if not exists documents_token_idx on documents(access_token);

alter table document_templates enable row level security;
alter table documents enable row level security;
do $$ begin
  create policy "authenticated full access" on document_templates
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "authenticated full access" on documents
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;
