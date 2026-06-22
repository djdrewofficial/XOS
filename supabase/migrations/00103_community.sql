-- XOS — Community board for the couple app. Every Xpress client/guest can post
-- (text, link, photo, poll), react, and comment; staff can pin + moderate.
--
-- PRIVACY: a couple's only PUBLIC info is first name + last initial, their event
-- cover photo (avatar), and the wedding month/year. The clients/events tables
-- stay locked down — public cards come from a SECURITY DEFINER function that
-- returns ONLY those four fields, so couples can never query each other's data.

create table if not exists community_posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text,
  link_url   text,
  image_url  text,
  image_path text,                  -- storage key (for cleanup)
  poll       jsonb,                 -- { question, options: [{ id, label }] }
  pinned     boolean not null default false,
  pinned_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_feed_idx on community_posts (pinned desc, created_at desc);
create index if not exists community_author_idx on community_posts (author_id);

create table if not exists community_reactions (
  post_id    uuid not null references community_posts(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  emoji      text not null default '❤️',
  created_at timestamptz not null default now(),
  primary key (post_id, account_id)
);

create table if not exists community_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references community_posts(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists community_comments_post_idx on community_comments (post_id, created_at);

create table if not exists community_poll_votes (
  post_id    uuid not null references community_posts(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  option_id  text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, account_id)   -- one vote per poll
);

-- ───────────────────────────── RLS ─────────────────────────────
alter table community_posts      enable row level security;
alter table community_reactions  enable row level security;
alter table community_comments   enable row level security;
alter table community_poll_votes enable row level security;

-- Posts: everyone signed in reads; you create your own; you delete your own and
-- staff can delete/pin (update) any.
do $$ begin
  create policy "read posts" on community_posts for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "create own post" on community_posts for insert to authenticated with check (author_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update own or staff" on community_posts for update to authenticated
    using (author_id = auth.uid() or xos_is_staff()) with check (author_id = auth.uid() or xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "delete own or staff" on community_posts for delete to authenticated
    using (author_id = auth.uid() or xos_is_staff());
exception when duplicate_object then null; end $$;

-- Reactions / votes: read all; write only your own row.
do $$ begin
  create policy "read reactions" on community_reactions for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own reactions" on community_reactions for all to authenticated
    using (account_id = auth.uid()) with check (account_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "read votes" on community_poll_votes for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own votes" on community_poll_votes for all to authenticated
    using (account_id = auth.uid()) with check (account_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Comments: read all; create your own; delete own or staff.
do $$ begin
  create policy "read comments" on community_comments for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "create own comment" on community_comments for insert to authenticated with check (author_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "delete own comment or staff" on community_comments for delete to authenticated
    using (author_id = auth.uid() or xos_is_staff());
exception when duplicate_object then null; end $$;

-- ───────── Public author cards (ONLY the four public fields) ─────────
create or replace function get_community_authors(p_ids uuid[])
returns table (author_id uuid, name text, avatar_url text, wedding_label text, is_staff boolean)
language sql stable security definer set search_path = public
as $$
  select
    a.auth_user_id,
    case
      when a.account_type = 'client' and cl.id is not null then
        trim(coalesce(cl.first_name, 'Xpress')) ||
        case when coalesce(cl.last_name, '') <> '' then ' ' || left(cl.last_name, 1) || '.' else '' end
      when a.account_type = 'event_guest' and g.id is not null then coalesce(g.first_name, 'Guest')
      when a.account_type not in ('client', 'event_guest') then
        nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
      else 'Xpress Couple'
    end as name,
    ev.cover_photo_url as avatar_url,
    case when ev.event_date is not null then to_char(ev.event_date, 'FMMonth YYYY') else null end as wedding_label,
    (a.account_type is null or a.account_type not in ('client', 'event_guest')) as is_staff
  from accounts a
  left join clients cl on cl.id = a.client_id
  left join event_guests g on g.id = a.event_guest_id
  left join employees e on e.id = a.employee_id
  left join lateral (
    select e2.cover_photo_url, e2.event_date
    from events e2
    where e2.client_id = a.client_id
    order by (e2.event_date >= current_date) desc, e2.event_date asc nulls last
    limit 1
  ) ev on true
  where a.auth_user_id = any(p_ids);
$$;
grant execute on function get_community_authors(uuid[]) to authenticated;

-- Photos bucket (public read; writes go through the admin upload route).
insert into storage.buckets (id, name, public) values ('community', 'community', true)
on conflict (id) do nothing;
