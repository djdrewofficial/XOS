-- Remove the Community feature (not being pursued). This also resolves the
-- audit findings that community_posts/comments/reactions/votes were readable by
-- every logged-in couple (cross-tenant), and that the community photo bucket was
-- public. Only test data existed (1 post / 1 comment / 1 reaction).
-- The couples' mobile app read/wrote these tables directly via Supabase; its
-- Community tab should be removed separately in the xpress-client repo.

drop table if exists public.community_comments   cascade;
drop table if exists public.community_poll_votes cascade;
drop table if exists public.community_reactions  cascade;
drop table if exists public.community_posts      cascade;

drop function if exists public.get_community_authors(uuid[]) cascade;

-- The public `community` storage bucket is removed separately via the Storage API
-- (SQL deletes on storage tables are blocked by a Supabase guard).
