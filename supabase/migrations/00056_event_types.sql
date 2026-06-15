-- XOS — narrow the active event types to the three Xpress does. Others are
-- deactivated (not deleted) so they can be re-enabled / new ones added under
-- Settings → Custom Fields.
update event_types set name = 'Corporate Event' where name = 'Corporate';

insert into event_types (name, is_active) values
  ('Wedding', true), ('Corporate Event', true), ('Quinceanera', true)
on conflict (name) do update set is_active = true;

update event_types set is_active = false
  where name not in ('Wedding', 'Corporate Event', 'Quinceanera');
