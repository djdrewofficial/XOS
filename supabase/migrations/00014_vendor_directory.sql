-- XOS — vendor directory upgrade: managed categories, preferred flag, socials, collab preference

create table vendor_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into vendor_categories (name) values
  ('Photographer'), ('Videographer'), ('Wedding Planner'), ('Florist'), ('Caterer'),
  ('Venue Coordinator'), ('Cake / Bakery'), ('Hair & Makeup'), ('Officiant'), ('Rentals'), ('Other');

alter table vendors add column if not exists category_id uuid references vendor_categories(id);
alter table vendors add column if not exists is_preferred boolean not null default false;
alter table vendors add column if not exists website text;
alter table vendors add column if not exists instagram text;
alter table vendors add column if not exists tiktok text;
alter table vendors add column if not exists youtube text;
-- when we post about a shared event: invite them to collab, just tag them, or either
alter table vendors add column if not exists social_collab text;
alter table vendors add constraint vendors_social_collab_check
  check (social_collab is null or social_collab in ('collab', 'tag', 'either'));

-- migrate any existing free-text categories
insert into vendor_categories (name)
select distinct trim(category) from vendors
where category is not null and trim(category) <> ''
on conflict (name) do nothing;

update vendors v
set category_id = c.id
from vendor_categories c
where v.category is not null and trim(v.category) = c.name and v.category_id is null;

alter table vendor_categories enable row level security;
create policy "authenticated full access" on vendor_categories for all to authenticated using (true) with check (true);
