-- XOS — import wedding-vendor directory from DJEP CSV export (24975_contacts).
-- Grouped by company: one vendors row per company, one vendor_contacts row per
-- person. Idempotent — skips a vendor that already exists (by name) and only
-- adds contacts not already present, so it is safe to re-run.

-- 7th Creations
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select '7th Creations', '6d55b975-3b8a-4e98-a7c0-5ebc7f47db52'::uuid, false, '7thcreations.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('7th Creations'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('7th Creations') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('David Drummer', 'Owner', '786-247-3862', 'info@7thcreations.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Uplight Miami
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Uplight Miami', '752a1d1b-a92b-4ec9-86dd-8a842f8833b9'::uuid, false, 'uplightmiami.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Uplight Miami'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Uplight Miami') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Ralph', 'Owner', '786-439-4258', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Naqeeb Shoots
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Naqeeb Shoots', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Naqeeb Shoots'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Naqeeb Shoots') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Test Neqeeb', null::text, null::text, 'djnaqeeb@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Golden Events by Annie Perez
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Golden Events by Annie Perez', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Golden Events by Annie Perez'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Golden Events by Annie Perez') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Annie Perez', null::text, null::text, 'annie@goldeneventsbyap.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Floraland Media
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Floraland Media', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'http://floralandnewyork.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Floraland Media'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Floraland Media') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Jing', 'Assistant', '917.930.2975', 'info@floralandnewyork.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Out of Box Weddings
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Out of Box Weddings', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://outofboxwedding.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Out of Box Weddings'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Out of Box Weddings') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Cemone Glinton', null::text, '(786)-273-9668', 'contact@outofboxwedding.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Christy Clark Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Christy Clark Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.christyclarkphotos.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Christy Clark Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Christy Clark Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Christy Clark', null::text, '305.902.9426', 'info@christyclarkphotos.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Everlasting Edits
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Everlasting Edits', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Everlasting Edits'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Everlasting Edits') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Karen Herrera', null::text, '(305) 742-4922', 'everlastingeditsbykaren@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Rosche Event Buro
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Rosche Event Buro', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://roscheeventburo.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Rosche Event Buro'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Rosche Event Buro') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Catherine Rosche', null::text, '7543647686', 'info@roscheeventburo.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Sebastiani Studios
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Sebastiani Studios', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Sebastiani Studios'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Sebastiani Studios') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Edwin Sebastiani', null::text, '786-402-3912', 'sebastianistudios@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Experience Love Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Experience Love Events', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Experience Love Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Experience Love Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sheena Brown', null::text, '954-667-2146', 'sheena@experienceloveevents.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Shots by Xyan
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Shots by Xyan', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.shotsbyxyan.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Shots by Xyan'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Shots by Xyan') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Xyan', null::text, '(954) 670-3980', 'info@shotsbyxyan.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Amarena Productions
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Amarena Productions', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'amarenaproductions.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Amarena Productions'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Amarena Productions') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Paula Martinez', null::text, '786-665-0487', 'info@amarenaproductions.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- A Christy Event
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'A Christy Event', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.achristyevent.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('A Christy Event'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('A Christy Event') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Christy Perez', null::text, null::text, 'Christy.events@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Molmar Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Molmar Events', '80478e1c-6012-4398-ae7b-4e50c369efb1'::uuid, false, 'molmargroup.com', '@instagram.com', null, 'collab'
  where not exists (select 1 from vendors where lower(company_name) = lower('Molmar Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Molmar Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Aura & Luis', null::text, '7862802376', 'molmargroup@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Bells & Whistles
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Bells & Whistles', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'bellswhistlesphoto.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Bells & Whistles'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Bells & Whistles') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Chris Frochaux', null::text, '(305) 965 – 4559', 'info@bellswhistlesphoto.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- The Palms Hotel
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'The Palms Hotel', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, 'thepalmshotel.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('The Palms Hotel'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('The Palms Hotel') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Vanessa Ortiz', null::text, '305-908-5410', 'vortiz@thepalmshotel.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Weddings By Danny
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Weddings By Danny', 'cf8836c1-9fdd-4590-8a94-0a8e8e88e102'::uuid, false, 'https://www.weddingsbydanny.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Weddings By Danny'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Weddings By Danny') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Danny Vasquez', null::text, null::text, null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Dream a Little Dream Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Dream a Little Dream Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Dream a Little Dream Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Dream a Little Dream Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Amy Collier', 'Owner', null::text, 'amy.dreamalittledreampix@yahoo.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- iRock Your Party
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'iRock Your Party', '6d55b975-3b8a-4e98-a7c0-5ebc7f47db52'::uuid, false, 'irockyourparty.com', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('iRock Your Party'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('iRock Your Party') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sebastian Gomez Eslava', null::text, '407-929-8877', 'Sebastian@irockyourparty.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Ledd Lens Photo and Film
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Ledd Lens Photo and Film', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://leddlens.com/', '@leddlens', null, 'collab'
  where not exists (select 1 from vendors where lower(company_name) = lower('Ledd Lens Photo and Film'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Ledd Lens Photo and Film') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Ledd Lens Photo and Film', null::text, '(407) 587-9952', 'info@leddlens.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Passionate Edge
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Passionate Edge', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'passionate-edge.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Passionate Edge'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Passionate Edge') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Shannon Pak', null::text, '954-590-0032', 'passionateedge@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Flavio Wedding Photography Studios
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Flavio Wedding Photography Studios', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'flaviophotographystudios.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Flavio Wedding Photography Studios'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Flavio Wedding Photography Studios') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Flavio De Moura', null::text, null::text, null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- CoFilmer
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'CoFilmer', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'cofilmer.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('CoFilmer'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('CoFilmer') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('CoFilmer', null::text, '7867312963', 'infocofilmerus@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- jupiter wedding photo
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'jupiter wedding photo', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.instagram.com/jupiterweddingphoto', '@jupiterweddingphoto', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('jupiter wedding photo'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('jupiter wedding photo') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Nick Post', null::text, '561-424-1507', 'Jupiterweddingphoto@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- GM Productions
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'GM Productions', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.gmproductions.tv/', '@gmproductions.tv', '@gmproductions.tv', 'collab'
  where not exists (select 1 from vendors where lower(company_name) = lower('GM Productions'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('GM Productions') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Gerardo Mata', null::text, '561-261-8113', 'Gerardo.Mata@gmproductions.tv')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Love and Heirloom Films
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Love and Heirloom Films', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'instagram.com/loveandheirloomfilms', '@instagram.com', null, 'collab'
  where not exists (select 1 from vendors where lower(company_name) = lower('Love and Heirloom Films'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Love and Heirloom Films') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Josh and Karla', null::text, null::text, null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Sylvia Rose Photo
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Sylvia Rose Photo', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://sylviarosephoto.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Sylvia Rose Photo'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Sylvia Rose Photo') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sylvia Rose', null::text, '+19206272190', 'hello@sylviarosephoto.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Villa Toscana Miami
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Villa Toscana Miami', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Villa Toscana Miami'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Villa Toscana Miami') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Linda Nolasco', null::text, null::text, 'linda@villa-toscana-miami.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Simply Captivating
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Simply Captivating', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://simplycaptivating.com', '@simplycaptivating', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Simply Captivating'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Simply Captivating') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Melissa Perez', null::text, '+1 (786) 663-8490', 'melissa@simplycaptivating.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Quality Media Photo & Video
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Quality Media Photo & Video', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'qualitymediafl.com', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Quality Media Photo & Video'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Quality Media Photo & Video') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Mikhail (Misha) Guseynov', null::text, '(734) 604-2846', 'qualitymediafl@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Yes to Wed - Planning Agency
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Yes to Wed - Planning Agency', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.yestowed.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Yes to Wed - Planning Agency'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Yes to Wed - Planning Agency') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Andie Martinesz', null::text, '786-928-2598', 'info@yestowed.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Sabrina Michelle Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Sabrina Michelle Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'http://sabrinamichellephotography.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Sabrina Michelle Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Sabrina Michelle Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sabrina Michelle', null::text, '(786) 212-7760', 'Sabrinamichellephotos@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Sush Digital Media
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Sush Digital Media', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://sushdigitalmedia.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Sush Digital Media'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Sush Digital Media') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Susana Henriquez', null::text, '(786) 505-1728', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Events by BBG
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Events by BBG', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.eventsbybbg.com/', '@Instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Events by BBG'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Events by BBG') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Brenda Garcia', null::text, '(786) 203-9526', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- GC Media Miami
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'GC Media Miami', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.gcmediamiami.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('GC Media Miami'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('GC Media Miami') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('GC Media Miami', null::text, null::text, 'gabrielchingolaniphotography@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Villa Toscana
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Villa Toscana', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Villa Toscana'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Villa Toscana') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Ivanna Jorge', null::text, '7863256990', 'ivanna@villa-toscana-miami.com'),
  ('Stephanie Hernandez', null::text, '+17868207830', 'villatoscana--stephanie-hernandez-@discussions.tripleseat.com'),
  ('Laura Moya', null::text, '+17868206138', 'laura@villa-toscana-miami.com'),
  ('Corina', null::text, null::text, 'corina@villa-toscana-miami.com'),
  ('Daniela Nobili', null::text, '+17866909082', 'daniela@villa-toscana-miami.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Love Story Collective
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Love Story Collective', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.lovestorycollective.co/', '@lovestorycollectiveco', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Love Story Collective'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Love Story Collective') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Love Story Collective', null::text, null::text, 'booking@lovestoryfilms.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- My Personal Cantor & Rabbi Debbi Ballard, Jewish Interfaith Officiant, Weddings, Bar Mitzvahs
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'My Personal Cantor & Rabbi Debbi Ballard, Jewish Interfaith Officiant, Weddings, Bar Mitzvahs', 'cf8836c1-9fdd-4590-8a94-0a8e8e88e102'::uuid, false, 'https://mypersonalcantor.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('My Personal Cantor & Rabbi Debbi Ballard, Jewish Interfaith Officiant, Weddings, Bar Mitzvahs'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('My Personal Cantor & Rabbi Debbi Ballard, Jewish Interfaith Officiant, Weddings, Bar Mitzvahs') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Debbi Ballard', null::text, '954-850-0453', 'debbi@mypersonalcantor.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- The Palms Hotel & Spa
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'The Palms Hotel & Spa', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, 'https://www.thepalmshotel.com/es', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('The Palms Hotel & Spa'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('The Palms Hotel & Spa') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Nataly Mejía', null::text, '3059085412', 'nmejia@thepalmshotel.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Peter J. Reinoso
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Peter J. Reinoso', 'cf8836c1-9fdd-4590-8a94-0a8e8e88e102'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Peter J. Reinoso'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Peter J. Reinoso') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Peter J. Reinoso', null::text, '786-269-5294', 'pjr.weddings@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Zoom Wedding Studio
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Zoom Wedding Studio', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://zoomweddingstudio.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Zoom Wedding Studio'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Zoom Wedding Studio') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Zoom Wedding Studio', null::text, '305-809-8552', 'zoomweddingstudio@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Robert Hallstrom
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Robert Hallstrom', 'cf8836c1-9fdd-4590-8a94-0a8e8e88e102'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Robert Hallstrom'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Robert Hallstrom') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Robert Hallstrom', null::text, '814-590-0423', 'bobhallstrom1@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Scribbled Moments Photography - Miami Wedding Photography - Palm Beach Wedding Photography - Orlando
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Scribbled Moments Photography - Miami Wedding Photography - Palm Beach Wedding Photography - Orlando', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'www.scribbledmomentsphotography.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Scribbled Moments Photography - Miami Wedding Photography - Palm Beach Wedding Photography - Orlando'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Scribbled Moments Photography - Miami Wedding Photography - Palm Beach Wedding Photography - Orlando') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Scribbled Moments Photography - Miami Wedding Photography - Palm Beach Wedding Photography - Orlando', null::text, '772-249-8922', 'scribbledmomentsphoto@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- We Do Too Planning
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'We Do Too Planning', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.wedotooplanning.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('We Do Too Planning'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('We Do Too Planning') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Elizabeth Samper', null::text, '17864739664', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Danielle Margherite Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Danielle Margherite Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://dmargherite.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Danielle Margherite Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Danielle Margherite Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Danielle Margherite', null::text, '13058781788', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- GoDariaFilms
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'GoDariaFilms', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://godariafilms.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('GoDariaFilms'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('GoDariaFilms') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Daria Opendik', null::text, '917-500-2461', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Until Forever Films LLC
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Until Forever Films LLC', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://untilforeverphotography.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Until Forever Films LLC'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Until Forever Films LLC') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Paola', null::text, '(954) 806-8557', 'untilforeverfilms@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Stephanie Sheehan
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Stephanie Sheehan', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Stephanie Sheehan'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Stephanie Sheehan') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Stephanie Sheehan', null::text, '(707) 815-8111', 'sbsheehan23@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Baker's Cay Resort Key Largo, Curio Collection by Hilton
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Baker''s Cay Resort Key Largo, Curio Collection by Hilton', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Baker''s Cay Resort Key Largo, Curio Collection by Hilton'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Baker''s Cay Resort Key Largo, Curio Collection by Hilton') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Magda Bates', null::text, '305-407-1131', 'mbates@bakerscay.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Waterman Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Waterman Events', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.watermanevents.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Waterman Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Waterman Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Caroline Waterman', null::text, '(305) 394-2219', 'caroline@watermanevents.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Meandering Media
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Meandering Media', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://meanderingmedia.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Meandering Media'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Meandering Media') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Bailey Myers', null::text, '386-956-2571', 'bailey@meanderingmedia.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Richardson Historic Park & Nature Preserve
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Richardson Historic Park & Nature Preserve', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Richardson Historic Park & Nature Preserve'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Richardson Historic Park & Nature Preserve') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Scott Holloway', null::text, '9543902104', 'sholloway@wiltonmanors.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Catering By Mark
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Catering By Mark', '80478e1c-6012-4398-ae7b-4e50c369efb1'::uuid, false, 'cateringbymark.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Catering By Mark'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Catering By Mark') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Catering By Mark', null::text, '(954) 224-1314', 'brfieldsol214@cateringbymark.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Loveland Venue
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Loveland Venue', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, 'https://www.lovelandvenue.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Loveland Venue'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Loveland Venue') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Camila', null::text, '3053169679', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Evoke Photo and Film
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Evoke Photo and Film', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://evokephotoandfilm.com/', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Evoke Photo and Film'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Evoke Photo and Film') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Evoke Photo and Film', null::text, '863-370-2730', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Eden Regal Ballroom & Catering
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Eden Regal Ballroom & Catering', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, 'http://www.cateringbyeden.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Eden Regal Ballroom & Catering'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Eden Regal Ballroom & Catering') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Eden Regal Ballroom & Catering', null::text, '(954)922-3344', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Alex Ruane
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Alex Ruane', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Alex Ruane'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Alex Ruane') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Alex Ruane', null::text, '(954)648-2042', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Kristin Rose
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Kristin Rose', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Kristin Rose'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Kristin Rose') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Kristin Rose', null::text, null::text, 'Kristinrosephotos@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Susana Hernandez
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Susana Hernandez', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'instagram.com/_timelesseventsandco/?hl=en', '@instagram.com', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Susana Hernandez'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Susana Hernandez') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Susana Hernandez', null::text, null::text, 'timelesseventsandco@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Victoria Babum
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Victoria Babum', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Victoria Babum'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Victoria Babum') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Victoria Babum', null::text, '3055055232', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Paige Davis Photo
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Paige Davis Photo', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.paigedavisphoto.com/', '@paigedavisphoto', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Paige Davis Photo'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Paige Davis Photo') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Paige Davis', null::text, '5615432846', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Dana Lynn Photos
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Dana Lynn Photos', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.danalynnphotos.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Dana Lynn Photos'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Dana Lynn Photos') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Dana Lynn', null::text, '+1 305-763-8045', 'info@danalynnphotography.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Solo Mio Photography LLC
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Solo Mio Photography LLC', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.solomiophoto.com/', '@instagram.com', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Solo Mio Photography LLC'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Solo Mio Photography LLC') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Solo Mio Photography LLC', null::text, '3059420978', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Courtney Clauser
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Courtney Clauser', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Courtney Clauser'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Courtney Clauser') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Courtney Clauser', null::text, null::text, 'courtney.clauser@boceanfortlauderdale.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Stephen Luttinger Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Stephen Luttinger Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.stephenluttingerphotography.com/', '@stephen_luttinger', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Stephen Luttinger Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Stephen Luttinger Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Stephen Luttinger', null::text, null::text, null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Islamorada Fish Company
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Islamorada Fish Company', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, 'islamoradafishco.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Islamorada Fish Company'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Islamorada Fish Company') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Islamorada Fish Company', null::text, '305-664-9271', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Jill Stewart
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Jill Stewart', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Jill Stewart'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Jill Stewart') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Jill Stewart', null::text, '305-664-9271', 'kjstewart2@basspro.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Lenisse Komatsu Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Lenisse Komatsu Photography', null, false, 'https://lenisse.com/', '@lenissekphoto', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Lenisse Komatsu Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Lenisse Komatsu Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Lenisse Komatsu', null::text, '5612672238', 'lenisse@lenisse.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Lucid Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Lucid Events', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.lucideventdesign.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Lucid Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Lucid Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Gina Damato', null::text, '862-485-6310', 'info@lucideventdesign.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Baylie Krutchik Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Baylie Krutchik Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://bayliekrutchik.me/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Baylie Krutchik Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Baylie Krutchik Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Baylie Krutchik', null::text, '954-612-4060', 'hello@Bayliekrutchik.me')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Famed Weddings
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Famed Weddings', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.instagram.com/famedweddings/', '@famedweddings', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Famed Weddings'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Famed Weddings') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sean LaRochelle', null::text, '954-299-7228', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Vibe Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Vibe Events', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Vibe Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Vibe Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Ashley Mckiernan', null::text, '5612909671', 'ashleymarkle18@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Sabatinos Catering
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Sabatinos Catering', null, false, 'https://sabatinoscatering.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Sabatinos Catering'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Sabatinos Catering') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sabatinos Catering', null::text, '5616906881', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Jim Scrima
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Jim Scrima', 'cf8836c1-9fdd-4590-8a94-0a8e8e88e102'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Jim Scrima'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Jim Scrima') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Jim Scrima', null::text, '954-680-0294', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Xenia SM Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Xenia SM Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.instagram.com/xeniasmphotography/', '@xeniasmphotography', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Xenia SM Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Xenia SM Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Xenia SM Photography', null::text, null::text, 'xeniasmphotography@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Rusty Pelican
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Rusty Pelican', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Rusty Pelican'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Rusty Pelican') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Rusty Pelican', null::text, '305-361-3818', 'jmartir@srcmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Jannette Alvarez Designs
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Jannette Alvarez Designs', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.jannettealvarezdesigns.com/', '@jannettealvarezdesigns', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Jannette Alvarez Designs'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Jannette Alvarez Designs') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Jannette Alvarez', null::text, '786-444-2719', 'jannette@jannettealvarezdesigns.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Melannie Morfa Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Melannie Morfa Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.melanniemorfa.com/', '@melanniemorfaphoto', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Melannie Morfa Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Melannie Morfa Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Melannie Morfa', null::text, '786-728-1611', 'info@melaniemorfa.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Ilse Marie Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Ilse Marie Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.instagram.com/ilse_marie_photography/?hl=en', '@ilse_marie_photography', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Ilse Marie Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Ilse Marie Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Ilse Gelinek', null::text, '786-426-6593', 'ilse.gelinek@ilsemariephotography.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Mission BBQ
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Mission BBQ', '80478e1c-6012-4398-ae7b-4e50c369efb1'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Mission BBQ'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Mission BBQ') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Mission BBQ', null::text, '561-210-3176', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Massy Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Massy Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.massylopezphotography.com/', '@massylopezweddingphotography', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Massy Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Massy Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Massy Lopez', null::text, '(561) 312-7984', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Miami Wedding Cinema
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Miami Wedding Cinema', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Miami Wedding Cinema'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Miami Wedding Cinema') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Miami Wedding Cinema', null::text, '7863401353', 'weddingcinema8@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Amanda De Arrastia
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Amanda De Arrastia', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Amanda De Arrastia'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Amanda De Arrastia') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Amanda De Arrastia', null::text, '772-200-2662', 'adearrastia@lessings.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Yolanda Hill Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Yolanda Hill Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.instagram.com/yolandahillphotography/', '@yolandahillphotography', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Yolanda Hill Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Yolanda Hill Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Yolanda Hill Photography', null::text, '954-445-5364', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Griselda Vasquez
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Griselda Vasquez', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Griselda Vasquez'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Griselda Vasquez') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Griselda Vasquez', null::text, '561-452-0733', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- C & C Catering Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'C & C Catering Events', '80478e1c-6012-4398-ae7b-4e50c369efb1'::uuid, false, 'candccateringevents.com', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('C & C Catering Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('C & C Catering Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Jessica', null::text, '(786)683-3386', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Rimas Films
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Rimas Films', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.rimasfilms.com/', '@rimasfilms', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Rimas Films'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Rimas Films') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Rimas Vasiulis', null::text, '(954)-600-2055', 'rimasfilms@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Amarena Productions LLC
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Amarena Productions LLC', null, false, 'https://amarenaproductions.com/', '@amarena.productions', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Amarena Productions LLC'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Amarena Productions LLC') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Amarena Productions LLC', null::text, '786-665-0487', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Double Tree by Hilton Grande Hotel Biscayne Bay
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Double Tree by Hilton Grande Hotel Biscayne Bay', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Double Tree by Hilton Grande Hotel Biscayne Bay'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Double Tree by Hilton Grande Hotel Biscayne Bay') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Adriana Rader', null::text, '305-372-0313', 'adriana.rader@hilton.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Adrian Mata Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Adrian Mata Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://adrianmataweddings.com/', '@adrianmataweddings', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Adrian Mata Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Adrian Mata Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Adrian Mata', null::text, '239-895-6953', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Caro Velasco
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Caro Velasco', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, '@katsaenzproductions', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Caro Velasco'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Caro Velasco') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Caro Velasco', null::text, '954-790-8653', 'info@katsaenzproductions.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Megan Kuhn Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Megan Kuhn Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://megankuhnphotography.com/', '@megankuhnphotography', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Megan Kuhn Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Megan Kuhn Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Megan Kuhn', null::text, '7707897380', 'megankuhnphotography@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Elvira Mk Films Wedding Videographer
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Elvira Mk Films Wedding Videographer', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, null, null, null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Elvira Mk Films Wedding Videographer'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Elvira Mk Films Wedding Videographer') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Elvira', null::text, '850-704-5934', 'elviramkfilms@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Dipp Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Dipp Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.dippphotography.com/', null, null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Dipp Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Dipp Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Dipp Photography', null::text, '+17865863085', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- NickFlicks Film + Photo
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'NickFlicks Film + Photo', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.nickflicksfilms.com/', null, null, 'none'
  where not exists (select 1 from vendors where lower(company_name) = lower('NickFlicks Film + Photo'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('NickFlicks Film + Photo') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('NickFlicks Film + Photo', null::text, '(727) 804-9538', 'nickflicksservices@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Ceremonies By Chrissy
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Ceremonies By Chrissy', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.ceremoniesbychrissy.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Ceremonies By Chrissy'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Ceremonies By Chrissy') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Chrissy Garcia', null::text, '407-473-1527', 'ceremoniesbychrissyg@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Darlene DeLuca
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Darlene DeLuca', 'cc5b0e00-cecc-42d5-9013-445224465721'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Darlene DeLuca'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Darlene DeLuca') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Darlene DeLuca', null::text, '9544748998', 'darcater@aol.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Wattley Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Wattley Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.wattleyph.com/', null, null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Wattley Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Wattley Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Andrea Wattley', null::text, null::text, 'wattleyph@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- CARRILLO FILMS
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'CARRILLO FILMS', null, false, 'https://www.instagram.com/carrilloweddingfilms/', '@carrilloweddingfilms', null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('CARRILLO FILMS'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('CARRILLO FILMS') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Carlos', null::text, null::text, null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Jessica Perez
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Jessica Perez', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, null, null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Jessica Perez'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Jessica Perez') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Jessica Perez', null::text, '786-820-7830', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Bridal On Cord
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Bridal On Cord', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://bridaloncord.com/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Bridal On Cord'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Bridal On Cord') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Sonja', null::text, '+1 (786) 543-8201', 'sonja@bridaloncord.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Meza Events
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Meza Events', 'b583c923-9cb6-4778-99d6-3455da91850d'::uuid, false, 'https://www.mezaevents.net/', null, null, null
  where not exists (select 1 from vendors where lower(company_name) = lower('Meza Events'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Meza Events') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Alejandra Clavijo', null::text, '754-214-8275', 'alejandra.mezaevents@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Audrey Uhing Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Audrey Uhing Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.audreyuhingphotography.com/', null, null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Audrey Uhing Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Audrey Uhing Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Audrey Uhing', null::text, '+19202859203', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Carolina Plaz Photography
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Carolina Plaz Photography', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://carolinaplazphotography.mypixieset.com/', '@carolinaplazphotography', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Carolina Plaz Photography'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Carolina Plaz Photography') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Carolina Plaz', null::text, '7866904300', null::text)
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);

-- Captivated Films
with v as (
  insert into vendors (company_name, category_id, is_preferred, website, instagram, tiktok, social_collab)
  select 'Captivated Films', 'cfe90f87-f3d1-4ec7-a453-fb47d51ff738'::uuid, false, 'https://www.instagram.com/captivatedfilms/?hl=en', '@captivatedfilms', null, 'tag'
  where not exists (select 1 from vendors where lower(company_name) = lower('Captivated Films'))
  returning id
), vid as (
  select id from v
  union all
  select id from vendors where lower(company_name) = lower('Captivated Films') limit 1
)
insert into vendor_contacts (vendor_id, name, role, phone, email)
select (select id from vid limit 1), x.name, x.role, x.phone, x.email
from (values
  ('Robert Molina', null::text, '786-663-8490', 'robertcaptivatedfilms@gmail.com')
) as x(name, role, phone, email)
where not exists (
  select 1 from vendor_contacts vc
  where vc.vendor_id = (select id from vid limit 1)
    and vc.name = x.name and coalesce(vc.phone,'') = coalesce(x.phone,'') and coalesce(vc.email,'') = coalesce(x.email,'')
);
