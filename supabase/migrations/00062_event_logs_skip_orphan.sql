-- Fix: deleting an event with child rows (e.g. event_equipment) failed with
-- event_logs_event_id_fkey. Child AFTER DELETE audit triggers (e.g.
-- event_equipment_log) insert into event_logs using the old event_id, but the
-- parent event is already deleted in the same transaction, so the FK insert is
-- rejected and the whole delete aborts. Centrally skip any event_logs insert
-- whose event no longer exists — this only ever drops a row that would have
-- crashed with the FK error; normal audit logging is unaffected.
create or replace function skip_orphan_event_log()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from events where id = new.event_id) then
    return null; -- event is being/already deleted — drop the orphan audit row
  end if;
  return new;
end;
$$;

drop trigger if exists event_logs_skip_orphan on event_logs;
create trigger event_logs_skip_orphan
  before insert on event_logs
  for each row execute function skip_orphan_event_log();
