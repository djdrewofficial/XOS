-- XOS — Assistant knowledge base. Articles authored in Settings → AI Assistant
-- are fed to the OpenAI-backed support bubble as context (retrieval, not fine-tuning).
create table if not exists kb_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  category text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table kb_articles enable row level security;
do $$ begin
  create policy "authenticated full access" on kb_articles
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
