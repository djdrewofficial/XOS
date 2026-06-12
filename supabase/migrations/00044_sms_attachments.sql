-- XOS — MMS: images/files on outbound texts.
-- Outbound media is uploaded to the public sms-media bucket (unguessable
-- uuid paths) so HighLevel/carriers can fetch it; sms_log carries the URLs.

alter table sms_log add column if not exists attachments text[] not null default '{}';

insert into storage.buckets (id, name, public)
values ('sms-media', 'sms-media', true)
on conflict (id) do nothing;

do $$ begin
  create policy "sms-media public read" on storage.objects
    for select to public using (bucket_id = 'sms-media');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "sms-media auth insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'sms-media');
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "sms-media auth delete" on storage.objects
    for delete to authenticated using (bucket_id = 'sms-media');
exception when duplicate_object then null;
end $$;
