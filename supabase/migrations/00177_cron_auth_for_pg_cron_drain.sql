-- The Netlify scheduled function (process-outbox) that drains the email/SMS outbox
-- does not reliably execute (empty logs for 7 days, "Run now" no-op), so queued mail
-- never sends. pg_cron IS reliable on this project, so a pg_cron job drives the drain
-- via net.http_post to /api/cron/send-outbox. That job authenticates with a
-- self-generated token stored here (rather than hand-copying the Netlify CRON_SECRET
-- into the DB), which the route also accepts. Service-role / owner only.
create table if not exists public.cron_auth (
  id         boolean primary key default true,
  token      text not null,
  created_at timestamptz not null default now(),
  constraint cron_auth_singleton check (id)
);
alter table public.cron_auth enable row level security;
-- no policies → only the service-role client (route) and superuser (pg_cron) can read it

insert into public.cron_auth (token)
values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;
