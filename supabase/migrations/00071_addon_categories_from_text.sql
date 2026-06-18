-- XOS — promote imported add-on text categories into real addon_categories so
-- they show as editable sections on the Packages & Add-Ons page.
insert into addon_categories (name, is_active)
select distinct a.category, true from addons a
where a.category is not null and a.category <> ''
  and not exists (select 1 from addon_categories ac where lower(ac.name) = lower(a.category));

update addons a set category_id = ac.id
from addon_categories ac
where a.category_id is null and a.category is not null and lower(a.category) = lower(ac.name);
