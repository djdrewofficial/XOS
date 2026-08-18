-- Fireflies.ai integration: import call notes/transcripts, matched to a client/event
-- by participant email (with manual override), and turn each call's action items into
-- SUGGESTED tasks a person approves (→ a real task) or dismisses. Nothing auto-created.

create table if not exists public.fireflies_meetings (
  id               uuid primary key default gen_random_uuid(),
  fireflies_id     text unique not null,
  title            text,
  meeting_date     timestamptz,
  duration_min     numeric,
  organizer_email  text,
  meeting_link     text,
  audio_url        text,
  transcript_url   text,
  participants     text[]  not null default '{}',
  attendees        jsonb   not null default '[]'::jsonb,   -- [{name,email}]
  summary_overview text,                                    -- short_summary / overview
  keywords         text[]  not null default '{}',
  action_items_raw text,                                    -- the grouped-by-person blob
  transcript       jsonb,                                   -- [{speaker,text,start}]
  transcript_text  text,                                    -- flattened, for display/search
  summary_status   text,
  -- matching
  event_id         uuid references public.events(id)  on delete set null,
  client_id        uuid references public.clients(id) on delete set null,
  matched_by       text check (matched_by in ('email','manual')),
  imported_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ff_meetings_event_idx  on public.fireflies_meetings(event_id);
create index if not exists ff_meetings_client_idx on public.fireflies_meetings(client_id);
create index if not exists ff_meetings_date_idx   on public.fireflies_meetings(meeting_date desc);

create table if not exists public.fireflies_suggested_tasks (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.fireflies_meetings(id) on delete cascade,
  assignee_name       text,                                 -- the **Name** header from the call
  suggested_employee_id uuid references public.employees(id) on delete set null, -- name-matched staff
  text                text not null,
  timestamp_label     text,                                 -- e.g. "21:29"
  status              text not null default 'suggested' check (status in ('suggested','approved','dismissed')),
  task_id             uuid references public.tasks(id) on delete set null,       -- set on approve
  decided_by          uuid references public.employees(id) on delete set null,
  decided_at          timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists ff_suggested_meeting_idx on public.fireflies_suggested_tasks(meeting_id);

alter table public.fireflies_meetings        enable row level security;
alter table public.fireflies_suggested_tasks enable row level security;
do $$ begin
  create policy "staff manage fireflies_meetings" on public.fireflies_meetings
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff manage fireflies_suggested" on public.fireflies_suggested_tasks
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
