-- XOS — documents attached to email templates + event files.
-- Email templates can carry a document template: as an e-sign link (document is
-- generated at send time, signing link merged into the body) or as a PDF
-- attachment (branded PDF rendered at send time, attached, and saved to the
-- event's files). The outbox processor does the work, so booking helpers,
-- scheduled templates, and manual sends all behave identically.

alter table email_templates add column if not exists attach_template_id uuid
  references document_templates(id) on delete set null;
alter table email_templates add column if not exists attach_mode text not null default 'esign_link'
  check (attach_mode in ('esign_link', 'pdf'));

-- record what got attached to each send (also the idempotency marker)
alter table email_log add column if not exists attached_document_id uuid
  references documents(id) on delete set null;
alter table email_log add column if not exists attached_file_name text;

-- ============ EVENT FILES ============
create table if not exists event_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  name text not null,
  path text not null,              -- storage object path in the event-files bucket
  content_type text not null default 'application/pdf',
  size_bytes bigint,
  source text not null default 'generated' check (source in ('generated', 'upload')),
  created_at timestamptz not null default now()
);
create index if not exists event_files_event_idx on event_files(event_id);

alter table event_files enable row level security;
do $$ begin
  create policy "authenticated full access" on event_files
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- private storage bucket for event files
insert into storage.buckets (id, name, public)
values ('event-files', 'event-files', false)
on conflict (id) do nothing;

do $$ begin
  create policy "authenticated event-files read" on storage.objects
    for select to authenticated using (bucket_id = 'event-files');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "authenticated event-files write" on storage.objects
    for insert to authenticated with check (bucket_id = 'event-files');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "authenticated event-files delete" on storage.objects
    for delete to authenticated using (bucket_id = 'event-files');
exception when duplicate_object then null;
end $$;
