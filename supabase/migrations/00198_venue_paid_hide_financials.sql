-- Venue-paid events (Villa Toscana packages / "Booked EV"): the couple must NEVER
-- see what the venue pays Xpress. Financials are hidden from the client when ANY
-- of these is true (an explicit events.hide_financials = false still overrides):
--   packages.hide_financials        — e.g. every "Toscana …" package
--   event_statuses.hide_financials  — e.g. "Booked EV"
--   event_types.hide_financials     — existing per-type default
-- events.hide_financials = true/false is the per-event manual override.
alter table public.packages add column if not exists hide_financials boolean not null default false;
alter table public.event_statuses add column if not exists hide_financials boolean not null default false;

update public.packages set hide_financials = true where name ilike '%toscana%';
update public.event_statuses set hide_financials = true where name ilike 'booked ev%';

-- One answer for every surface (SQL merge tags, scheduled emails, app code).
create or replace function public.event_financials_hidden(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    e.hide_financials,
    coalesce(p.hide_financials, false) or coalesce(s.hide_financials, false) or coalesce(t.hide_financials, false)
  )
  from events e
  left join packages p on p.id = e.package_id
  left join event_statuses s on s.id = e.status_id
  left join event_types t on t.id = e.event_type_id
  where e.id = p_event_id
$$;
revoke all on function public.event_financials_hidden(uuid) from public, anon;
grant execute on function public.event_financials_hidden(uuid) to authenticated, service_role;
