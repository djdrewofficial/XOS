-- XOS — global staff settings (DJEP Employee Settings parity)
-- Single-row table like company_settings. Per-employee values stay on employees
-- (permission_tier, hourly_rate, check_in_required, can_send_as_self, display_order)
-- and are surfaced in both the employee profile and Staff Settings.

create table if not exists staff_settings (
  id boolean primary key default true check (id),

  -- FEATURES (employee portal capabilities for basic employee tier)
  feat_time_off boolean not null default true,
  feat_confirm_events boolean not null default true,
  feat_decline_events boolean not null default true,
  feat_check_in_out boolean not null default true,
  feat_timesheets boolean not null default true,
  feat_wage_report boolean not null default false,
  feat_available_events boolean not null default false,
  feat_event_count boolean not null default true,

  -- TIME OFF REQUEST SETTINGS
  time_off_mode text not null default 'any'
    check (time_off_mode in ('any', 'advance_notice', 'none')),
  time_off_advance_days int,
  time_off_allow_delete boolean not null default true,
  time_off_auto_approve boolean not null default false,
  time_off_terminology text not null default 'Approved',

  -- DECLINE EVENT / EVENT COUNT SETTINGS
  decline_requires_reason boolean not null default true,
  show_past_event_count boolean not null default false,
  show_upcoming_event_count boolean not null default false,

  -- ACCESS TO EVENTS (basic employees)
  access_status_ids uuid[],     -- null/empty = events with any status
  access_days_before int,       -- only see events this many days ahead (null = unlimited)
  access_days_after int,        -- only see events this many days back (null = unlimited)

  -- PERMISSIONS FOR BASIC EMPLOYEES (key -> boolean maps; UI applies defaults)
  perm_sections jsonb not null default '{}'::jsonb,
  perm_view jsonb not null default '{}'::jsonb,
  perm_notes jsonb not null default '{}'::jsonb,
  -- EMPLOYEE PORTAL self-service fields: key -> {"view": bool, "edit": bool}
  portal_fields jsonb not null default '{}'::jsonb,

  -- SYSTEM NOTIFICATIONS (comma-separated emails; blank = company email; 'NONE' disables)
  notify_request_event text,
  notify_check_in text,
  notify_check_out text,
  notify_timesheet text,
  notify_time_off text,
  notify_confirm_decline text,
  notify_confirm_also_salesperson boolean not null default true,

  -- ASSIGNMENT NOTIFICATIONS (employee / salesperson assigned to an event)
  assign_employee_template_id uuid references email_templates(id) on delete set null,
  assign_salesperson_template_id uuid references email_templates(id) on delete set null,
  assign_mark_notified boolean not null default false,
  notif_exclude_employee_ids uuid[],
  notif_exclude_status_ids uuid[],

  -- PAYROLL
  payroll_sort_day text not null default 'event_type'
    check (payroll_sort_day in ('event_type', 'event_time', 'client_name')),
  payroll_sort_event text not null default 'first_last'
    check (payroll_sort_event in ('first_last', 'last_first', 'role')),
  payroll_name_format text not null default 'first_last'
    check (payroll_name_format in ('first_last', 'last_first', 'stage_name')),
  payroll_start_offset_days int not null default 7,
  payroll_end_offset_days int not null default 0,
  payroll_export_fields text[] not null default array[
    'event_id', 'event_type', 'event_date', 'client_name',
    'employee_name', 'employee_role', 'wage'
  ],

  -- CHECK AVAILABILITY SORT METHOD
  availability_sort text not null default 'display_order'
    check (availability_sort in ('display_order', 'first_name', 'last_name')),

  updated_at timestamptz not null default now()
);

insert into staff_settings (id) values (true) on conflict (id) do nothing;

alter table staff_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on staff_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- EMPLOYEE DISPLAY ORDER (drop-down ordering; higher = earlier, like DJEP)
alter table employees add column if not exists display_order int not null default 0;
