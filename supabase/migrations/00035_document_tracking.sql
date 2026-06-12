-- XOS — document view tracking + client visibility (event Documents tab).
-- Views are logged by the public signing link (phase 2); the tab shows the
-- DJEP-style tracking panel (views before signature, unique IPs, last visit).

create table if not exists document_views (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  ip text,
  user_agent text,
  viewed_at timestamptz not null default now()
);
create index if not exists document_views_doc_idx on document_views(document_id);

alter table document_views enable row level security;
do $$ begin
  create policy "authenticated full access" on document_views
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- whether the client can see this document in their portal / link (DJEP parity)
alter table documents add column if not exists visible_to_client boolean not null default true;
