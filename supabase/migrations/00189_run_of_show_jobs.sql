-- Async run-of-show generation. The route builds the (fast) event context, inserts a
-- job, and triggers a Netlify BACKGROUND function (15-min limit) that does the slow
-- OpenAI synthesis + PDF render + save + email — the sync 26s function limit can't fit
-- it. The button polls this row for status.
create table if not exists public.run_of_show_jobs (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued','running','done','error')),
  email_staff  boolean not null default false,
  requested_by uuid references public.employees(id) on delete set null,
  file_id      uuid references public.event_files(id) on delete set null,
  file_name    text,
  emailed      int,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ros_jobs_event_idx on public.run_of_show_jobs(event_id, created_at desc);
alter table public.run_of_show_jobs enable row level security;
do $$ begin
  create policy "staff manage ros jobs" on public.run_of_show_jobs
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
