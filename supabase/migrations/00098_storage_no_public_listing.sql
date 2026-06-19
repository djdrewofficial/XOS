-- XOS — stop anonymous listing/enumeration of the public storage buckets.
--
-- Supabase advisor 0025_public_bucket_allows_listing: the sms-media, staff, and
-- equipment buckets each carry a broad SELECT policy on storage.objects granted
-- to the `public` role, which lets ANYONE list every file in the bucket (e.g.
-- enumerate every client MMS attachment, every staff photo). A public bucket
-- does NOT need this policy to serve files by URL — the bucket's `public=true`
-- flag serves `/object/public/<bucket>/<path>` directly, bypassing RLS. So these
-- SELECT policies add nothing but the enumeration hole.
--
-- Verified no code path needs them: the app stores object paths in the DB and
-- renders images via getPublicUrl (pure string-built public URLs, no RLS), and
-- outbound MMS hands GHL the public URL to fetch — all of which keep working.
-- No .list() or createSignedUrl call targets these buckets. Uploads/removes are
-- unaffected (their INSERT/DELETE policies remain).
--
-- Net effect: public file URLs still resolve; listing all files no longer does.

drop policy if exists "sms-media public read" on storage.objects;
drop policy if exists "staff public read" on storage.objects;
drop policy if exists "equipment public read" on storage.objects;
