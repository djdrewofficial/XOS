-- XOS — vendors on events, and inquiry sources linkable to venues/vendors for attribution

create table event_vendors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade,
  role text not null default 'Vendor', -- Photographer, Videographer, Planner, Florist, Caterer...
  notes text,
  created_at timestamptz not null default now(),
  unique (event_id, vendor_id)
);
create index event_vendors_event_idx on event_vendors(event_id);
create index event_vendors_vendor_idx on event_vendors(vendor_id);

alter table event_vendors enable row level security;
create policy "authenticated full access" on event_vendors for all to authenticated using (true) with check (true);

-- inquiry sources can point at the venue or vendor that referred the lead
alter table inquiry_sources add column if not exists venue_id uuid references venues(id);
alter table inquiry_sources add column if not exists vendor_id uuid references vendors(id);

-- best-effort link for the seeded Villa Toscana source
update inquiry_sources s
set venue_id = v.id
from venues v
where s.name = 'Villa Toscana Miami' and v.name ilike '%villa toscana%' and s.venue_id is null;

-- audit log
create or replace function log_event_vendor_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select company_name into v_name from vendors where id = new.vendor_id;
    insert into event_logs (event_id, actor, action)
    values (new.event_id, current_actor(), 'Vendor added: ' || coalesce(v_name, '?') || ' (' || new.role || ')');
    return new;
  else
    select company_name into v_name from vendors where id = old.vendor_id;
    insert into event_logs (event_id, actor, action)
    values (old.event_id, current_actor(), 'Vendor removed: ' || coalesce(v_name, '?'));
    return old;
  end if;
end;
$$;

create trigger event_vendors_log after insert or delete on event_vendors
  for each row execute function log_event_vendor_changes();
