-- XOS — employee profiles: stage name, photo, bio, employment details

alter table employees add column if not exists stage_name text;
alter table employees add column if not exists photo_path text;
alter table employees add column if not exists bio text;
alter table employees add column if not exists notes text;
alter table employees add column if not exists address text;
alter table employees add column if not exists hired_date date;
alter table employees add column if not exists profession_since int;

-- public storage bucket for staff photos
insert into storage.buckets (id, name, public)
values ('staff', 'staff', true)
on conflict (id) do nothing;

create policy "staff public read" on storage.objects
  for select to public using (bucket_id = 'staff');
create policy "staff auth insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'staff');
create policy "staff auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'staff');
