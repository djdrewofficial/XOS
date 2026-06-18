-- XOS — legacy DJEP venue mapping, so migrated DJEP events can be associated to
-- XOS venues. (Venue data itself was bulk-imported separately into the DB.)

alter table venues add column if not exists legacy_djep_id text;
do $$ begin
  alter table venues add constraint venues_legacy_djep_key unique (legacy_djep_id);
exception when duplicate_object then null; when duplicate_table then null; end $$;

-- Every DJEP venue id resolves to an XOS venue, or to "use the client's address"
-- (home parties / placeholder venues that were not imported).
create table if not exists venue_djep_map (
  djep_venue_id text primary key,
  venue_id uuid references venues(id) on delete cascade,
  resolution text not null check (resolution in ('venue', 'client_address')),
  source_name text,
  note text,
  created_at timestamptz not null default now()
);
alter table venue_djep_map enable row level security;
do $$ begin
  create policy "authenticated full access" on venue_djep_map
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
