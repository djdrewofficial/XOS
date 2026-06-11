-- XOS — per-assignment staff times (employee-specific call times, separate from event times)
alter table event_staff add column if not exists start_time time;
alter table event_staff add column if not exists end_time time;
