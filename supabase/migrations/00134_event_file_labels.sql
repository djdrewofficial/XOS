-- Labeled event files: a configurable label list (Settings → Custom Fields), a
-- label on each event file, and a per-label email-attach merge tag
-- (<document_timeline> attaches all Timeline-labeled files). Google Drive backup
-- is a later phase.

create table if not exists file_label_definitions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null,            -- normalized key; drives the <document_slug> tag
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists file_label_slug_uq on file_label_definitions(slug);

alter table file_label_definitions enable row level security;
do $$ begin
  create policy "staff manage file labels" on file_label_definitions
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Each event file can carry one label. FK (not text) so renames follow.
alter table event_files add column if not exists label_id uuid references file_label_definitions(id) on delete set null;

-- Pre-existing bug: the mobile planner-timeline upload inserts source='planner_timeline',
-- which the original CHECK ('generated','upload') rejects. Widen it.
alter table event_files drop constraint if exists event_files_source_check;
alter table event_files add constraint event_files_source_check
  check (source in ('generated','upload','planner_timeline'));

-- Seed a couple of example labels + their attach merge tags.
insert into file_label_definitions (name, slug, sort_order)
select v.name, v.slug, v.ord from (values
  ('Timeline', 'timeline', 0),
  ('First Dance', 'first_dance', 1)
) as v(name, slug, ord)
where not exists (select 1 from file_label_definitions f where f.slug = v.slug);

-- Register the <document_slug> attach tags in the merge-tag catalog so they show
-- in the editor. is_builtin=true so render_merge_tags leaves them alone — they're
-- resolved (into attachments) at send time in enrichMessage.
insert into merge_tags (tag_key, label, group_name, description, is_builtin, source_type, is_active, sort_order)
select 'document_' || f.slug,
       'Attach: ' || f.name || ' files',
       'Files',
       'Attaches all files labeled "' || f.name || '" to the email (large files become download links).',
       true, 'attachment', true, 0
from file_label_definitions f
where not exists (select 1 from merge_tags m where m.tag_key = 'document_' || f.slug);
