-- XOS — General application settings (DJEP General Settings parity, trimmed to what we use).
-- Lives on company_settings: timezone is already there and drives scheduled emails.

alter table company_settings add column if not exists phone_format_enabled boolean not null default true;
alter table company_settings add column if not exists browser_autocomplete boolean not null default false;
alter table company_settings add column if not exists notif_sound boolean not null default false;
alter table company_settings add column if not exists notif_types text[] not null default array[
  'pending_timesheets', 'assignment_requests', 'time_off_requests',
  'unassigned_pending_payments', 'new_payment_received'
];
alter table company_settings add column if not exists inbox_show_counter boolean not null default true;
alter table company_settings add column if not exists default_template_event_id uuid references events(id) on delete set null;
alter table company_settings add column if not exists landing_page text not null default '/';

-- seed the template-preview event with the first event on file (today's placeholder event)
update company_settings
set default_template_event_id = (select id from events order by created_at limit 1)
where default_template_event_id is null;
