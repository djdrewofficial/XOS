-- Short links: map a short code to a target path (e.g. a proposal at
-- /proposal/<pay_token>) so staff can send a tidy xos.xpressdjs.com/p/<code>
-- URL instead of a long UUID link. Accessed only by the service-role admin
-- client (the /p/[code] redirect route + the mint helper) — RLS on, no policies.
create table if not exists public.short_links (
  code          text primary key,
  target_path   text not null,          -- app-relative, e.g. /proposal/<token>
  kind          text,                    -- e.g. 'proposal'
  event_id      uuid references events(id) on delete cascade,
  clicks        int not null default 0,
  last_click_at timestamptz,
  created_at    timestamptz not null default now()
);

-- One short link per (event, kind) so re-minting is idempotent (get-or-create).
create unique index if not exists short_links_event_kind_uq
  on public.short_links(event_id, kind) where event_id is not null;

alter table public.short_links enable row level security;
-- intentionally no policies: service-role admin client only.

-- Cheap, safe click counter for the redirect route (service_role only).
create or replace function public.increment_short_link_click(p_code text)
 returns void language sql security definer set search_path to 'public'
as $$ update public.short_links set clicks = clicks + 1, last_click_at = now() where code = p_code; $$;
revoke execute on function public.increment_short_link_click(text) from public, anon;
grant execute on function public.increment_short_link_click(text) to service_role;
