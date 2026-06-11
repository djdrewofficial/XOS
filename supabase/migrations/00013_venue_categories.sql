-- XOS — venue categories (managed list, like equipment storage locations)

create table venue_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table venues add column if not exists category_id uuid references venue_categories(id);

insert into venue_categories (name) values
  ('Banquet Hall'), ('Hotel / Resort'), ('Country Club'), ('Private Estate'),
  ('Restaurant'), ('Outdoor / Garden'), ('Beach'), ('Corporate Space'), ('Other');

-- migrate any existing free-text categories
insert into venue_categories (name)
select distinct trim(category) from venues
where category is not null and trim(category) <> ''
on conflict (name) do nothing;

update venues v
set category_id = c.id
from venue_categories c
where v.category is not null and trim(v.category) = c.name and v.category_id is null;

alter table venue_categories enable row level security;
create policy "authenticated full access" on venue_categories for all to authenticated using (true) with check (true);
