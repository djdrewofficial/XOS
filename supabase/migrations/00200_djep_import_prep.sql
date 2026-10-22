-- DJEP → XOS full import prep.
-- 1) payments carry DJEP's payment "ID Number" so re-running the import never
--    duplicates a payment.
alter table public.payments add column if not exists legacy_djep_id text;
create unique index if not exists payments_legacy_djep_id_key on public.payments (legacy_djep_id) where legacy_djep_id is not null;

-- 2) Drew had two employee rows: his real login (drew@, master_admin) and an
--    inactive duplicate created by the June DJEP staff import (events@, DJEP id
--    47715 "Andrew Segura"). Point everything at the real one and move the DJEP
--    link to it, so imported events land on his calendar / "my events".
do $$
declare
  real_id uuid := (select id from employees where email = 'drew@xpressdjs.com' and permission_tier = 'master_admin' limit 1);
  dupe_id uuid := (select id from employees where legacy_djep_id = '47715' and email = 'events@xpressdjs.com' limit 1);
begin
  if real_id is null or dupe_id is null or real_id = dupe_id then
    return; -- already merged (or nothing to do)
  end if;
  update events set salesperson_id = real_id where salesperson_id = dupe_id;
  update events set point_of_contact_employee_id = real_id where point_of_contact_employee_id = dupe_id;
  -- staff assignments: move, skipping events where the real record is already assigned
  update event_staff s set employee_id = real_id
    where s.employee_id = dupe_id
      and not exists (select 1 from event_staff x where x.event_id = s.event_id and x.employee_id = real_id);
  delete from event_staff where employee_id = dupe_id;
  update employees set legacy_djep_id = null where id = dupe_id;
  update employees set legacy_djep_id = '47715' where id = real_id;
  update employees set is_active = false, notes = trim(coalesce(notes, '') || E'\nMerged into Drew''s real XOS record (DJEP import, 2026-10).') where id = dupe_id;
end $$;
