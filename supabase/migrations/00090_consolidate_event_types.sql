-- Consolidate system-wide event types to exactly: Wedding, Quince, Corporate, Other.
-- Removes Bar/Bat Mitzvah, Birthday, Holiday Party, School Event, Sweet 16.

-- 1) Rename Quinceanera -> Quince
update event_types set name = 'Quince' where name = 'Quinceanera';

-- 2) Safety: move any events/templates on a removed type to "Other" (currently none).
do $$
declare other_id uuid;
declare removed text[] := array['Bar/Bat Mitzvah','Birthday','Holiday Party','School Event','Sweet 16'];
begin
  select id into other_id from event_types where name = 'Other' limit 1;
  if other_id is not null then
    update events set event_type_id = other_id
      where event_type_id in (select id from event_types where name = any(removed));
    update planning_templates set event_type_id = other_id
      where event_type_id in (select id from event_types where name = any(removed));
  end if;
end $$;

-- 3) Remove the extras.
delete from event_types
 where name in ('Bar/Bat Mitzvah','Birthday','Holiday Party','School Event','Sweet 16');
