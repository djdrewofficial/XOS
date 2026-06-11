-- XOS — equipment photos (Supabase Storage) for items and systems

create table equipment_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references equipment_items(id) on delete cascade,
  system_id uuid references equipment_systems(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now(),
  check (item_id is not null or system_id is not null)
);
create index equipment_photos_item_idx on equipment_photos(item_id);
create index equipment_photos_system_idx on equipment_photos(system_id);

alter table equipment_photos enable row level security;
create policy "authenticated full access" on equipment_photos for all to authenticated using (true) with check (true);

-- public storage bucket for equipment photos
insert into storage.buckets (id, name, public)
values ('equipment', 'equipment', true)
on conflict (id) do nothing;

create policy "equipment public read" on storage.objects
  for select to public using (bucket_id = 'equipment');
create policy "equipment auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'equipment');
create policy "equipment auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'equipment');
