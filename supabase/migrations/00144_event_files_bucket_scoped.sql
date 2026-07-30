-- SECURITY: scope the private `event-files` bucket to the event.
-- The old policies granted read/insert/delete to ANY authenticated user for the
-- whole bucket (only bucket_id was checked), so any client/guest could download
-- or delete every event's private contracts/timelines. Files are stored at
-- `<eventId>/...`, so we scope on the first path segment.
-- Note: all app writes/downloads go through the service-role admin client (which
-- bypasses RLS); the only user-session access is staff creating signed URLs on
-- the event page, plus hosts reaching their own event's files.

drop policy if exists "authenticated event-files read"   on storage.objects;
drop policy if exists "authenticated event-files write"  on storage.objects;
drop policy if exists "authenticated event-files delete" on storage.objects;

-- Read: staff (all) or a host/guest of the specific event. The uuid regex guard
-- short-circuits before the ::uuid cast so a malformed path can never error the query.
create policy "event-files read scoped" on storage.objects for select to authenticated
  using (
    bucket_id = 'event-files'
    and (
      xos_is_staff()
      or (
        (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        and xos_can_access_event(((storage.foldername(name))[1])::uuid)
      )
    )
  );

-- Write/Delete: staff only (app uploads/deletes run via the admin client anyway).
create policy "event-files staff write" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-files' and xos_is_staff());

create policy "event-files staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-files' and xos_is_staff());
