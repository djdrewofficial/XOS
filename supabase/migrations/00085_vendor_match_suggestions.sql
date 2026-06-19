-- GPT vendor matching: a review queue of suggested matches/fills for vendors
-- couples add in the client app. Nothing is applied automatically — staff
-- approve or dismiss each suggestion.

create table if not exists vendor_match_suggestions (
  id                uuid primary key default gen_random_uuid(),
  event_vendor_id   uuid not null references event_vendors(id) on delete cascade,
  event_id          uuid references events(id) on delete cascade,
  matched_vendor_id uuid references vendors(id) on delete set null,
  kind              text not null check (kind in ('merge','fill','duplicate')),
  confidence        text,                 -- high | medium | low
  rationale         text,
  proposed          jsonb not null default '{}'::jsonb, -- corrected_name, contact_* fills, matched_vendor_name
  status            text not null default 'pending' check (status in ('pending','applied','dismissed')),
  created_at        timestamptz not null default now()
);
create index if not exists vms_status_idx on vendor_match_suggestions(status, created_at desc);
create index if not exists vms_event_vendor_idx on vendor_match_suggestions(event_vendor_id);

alter table vendor_match_suggestions enable row level security;
do $$ begin
  create policy "staff manage vendor suggestions" on vendor_match_suggestions
    for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
exception when duplicate_object then null; end $$;

-- Marker so the daily matcher only processes each couple-added vendor once.
alter table event_vendors add column if not exists match_checked_at timestamptz;
