-- Push targeting by role needs to reach the owner login too, which has no
-- employees row (treated as master_admin). Tag each device with an effective
-- tier so role audiences can push to owner devices, not just employee devices.
alter table device_tokens add column if not exists effective_tier text;

-- Backfill: linked employees use their tier; owner/unlinked staff tokens (no
-- employee_id) are effectively master_admin.
update device_tokens dt
set effective_tier = e.permission_tier
from employees e
where dt.employee_id = e.id and dt.effective_tier is null;

update device_tokens
set effective_tier = 'master_admin'
where employee_id is null and effective_tier is null;
