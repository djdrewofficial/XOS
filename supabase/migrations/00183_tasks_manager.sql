-- Tasks Manager — an internal staff to-do system that replaces Notion. Two halves:
--   1. task_rules   — automation definitions (the "Settings" screen). A rule is an
--      anchor+offset ("4 days before event") plus JSON conditions ("event is a
--      Wedding AND no DJ assigned") plus a task template (title/assignee/due).
--   2. tasks        — the generated (or manually created) to-do instances (the main
--      screen), each linked to a real event/client so "Request Timeline for Maribel
--      & Rafael's Wedding" is a live link, not free text.
-- Conditions are evaluated in TypeScript (src/lib/taskRules.ts) by a shared engine
-- run daily via pg_cron AND on-demand from a "Run rules now" button. Dedupe via
-- tasks.dedupe_key guarantees a rule creates at most one task per event.
-- Modeled on the payment_reminder_rules + payment_reminder_sends precedent (00125).

-- ---- task_rules -----------------------------------------------------------
create table if not exists public.task_rules (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  is_active            boolean not null default true,

  -- WHEN. anchor is the date the offset is measured from; 'none' = a standing
  -- condition-only rule evaluated daily against upcoming events (bounded by horizon_days).
  trigger_anchor       text not null default 'event_date'
                         check (trigger_anchor in
                           ('event_date','booked_date','contract_due_date','created_at','none')),
  offset_days          int  not null default 0,      -- <0 before anchor, 0 on, >0 after
  horizon_days         int,                          -- 'none' rules only look this many days ahead

  -- CONDITIONS. array of {field, op, value}; logic joins them.
  conditions           jsonb not null default '[]'::jsonb,
  condition_logic      text  not null default 'all' check (condition_logic in ('all','any')),

  -- WHAT TASK TO CREATE
  task_title           text not null,                -- supports {{event_label}}, {{client_name}}, {{event_date}}, {{dj_name}}, {{event_number}}
  task_body            text,
  task_priority        text not null default 'normal' check (task_priority in ('low','normal','high')),
  assignee_type        text not null default 'unassigned'
                         check (assignee_type in
                           ('unassigned','staff','department','event_poc','event_salesperson','event_dj')),
  assignee_employee_id uuid references public.employees(id) on delete set null, -- assignee_type='staff'
  assignee_department  text,                          -- assignee_type='department' (employees.staff_category)
  due_offset_days      int  not null default 0,       -- due date = due_anchor + due_offset_days
  due_anchor           text,                          -- null → same as trigger_anchor (falls back to today for 'none')

  -- AUTHORING
  source               text not null default 'manual' check (source in ('manual','ai')),
  ai_prompt            text,                          -- original plain-English request, when source='ai'
  created_by           uuid references public.employees(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  last_evaluated_at    timestamptz
);
create index if not exists task_rules_active_idx on public.task_rules(is_active);

-- ---- tasks ----------------------------------------------------------------
create table if not exists public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  body                 text,
  status               text not null default 'not_started'
                         check (status in ('not_started','in_progress','done','dismissed')),
  priority             text not null default 'normal' check (priority in ('low','normal','high')),

  assigned_employee_id uuid references public.employees(id) on delete set null,
  department           text,                          -- staff_category snapshot, for filtering

  event_id             uuid references public.events(id)   on delete cascade,
  client_id            uuid references public.clients(id)  on delete set null,
  rule_id              uuid references public.task_rules(id) on delete set null, -- null = manual

  due_date             date,
  -- one task per (rule, event): 'rule:<id>:event:<id>'. null for manual tasks.
  dedupe_key           text,

  completed_at         timestamptz,
  completed_by         uuid references public.employees(id) on delete set null,
  created_by           uuid references public.employees(id) on delete set null, -- null = system/auto
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists tasks_dedupe_uniq on public.tasks(dedupe_key) where dedupe_key is not null;
create index if not exists tasks_status_idx   on public.tasks(status);
create index if not exists tasks_assignee_idx on public.tasks(assigned_employee_id);
create index if not exists tasks_event_idx    on public.tasks(event_id);
create index if not exists tasks_due_idx       on public.tasks(due_date);

-- ---- task_comments --------------------------------------------------------
create table if not exists public.task_comments (
  id                   uuid primary key default gen_random_uuid(),
  task_id              uuid not null references public.tasks(id) on delete cascade,
  author_employee_id   uuid references public.employees(id) on delete set null,
  body                 text not null,
  created_at           timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments(task_id);

-- ---- RLS. Staff-only (screens are RBAC-gated; cron uses service role, bypassing RLS).
alter table public.task_rules    enable row level security;
alter table public.tasks         enable row level security;
alter table public.task_comments enable row level security;
do $$ begin
  create policy "staff manage task_rules" on public.task_rules
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff manage tasks" on public.tasks
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff manage task_comments" on public.task_comments
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- ---- RBAC: register the "tasks" module so it shows in Settings → Permissions.
-- Code default in src/lib/permissions.ts keeps things sane before/after this runs.
insert into public.role_permissions (role, module, access) values
  ('admin','tasks','edit'),
  ('salesperson','tasks','edit'),
  ('employee','tasks','view')
on conflict (role, module) do nothing;

-- ---- Daily engine. pg_cron posts to the TS evaluator (same reliable pattern as the
-- email drain: reads the shared cron_auth token, no secret inlined). ~7am ET.
do $$ begin
  perform cron.schedule(
    'xos-task-rules',
    '0 11 * * *',
    $cron$
    select net.http_post(
      url := 'https://xos.xpressdjs.com/api/cron/task-rules',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select token from public.cron_auth limit 1)),
      timeout_milliseconds := 60000
    );
    $cron$
  );
exception when others then null; end $$;
