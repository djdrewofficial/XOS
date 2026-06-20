-- Add-on → planning section templates. When an add-on is attached to an event,
-- its mapped reusable section(s) are cloned into the event's planner
-- automatically — mirrors addon_equipment_defaults (gear) and addon→section
-- mapping in Vibo's "favorites". The "section templates" are
-- planning_template_sections; keep reusable add-on sections in a non-default
-- library template (no event_type, not is_default) so they ONLY land on an event
-- via an add-on, not via the base template seed.

create table if not exists addon_section_templates (
  id uuid primary key default gen_random_uuid(),
  addon_id uuid not null references addons(id) on delete cascade,
  template_section_id uuid not null references planning_template_sections(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (addon_id, template_section_id)
);
create index if not exists addon_section_templates_addon_idx on addon_section_templates(addon_id);

alter table addon_section_templates enable row level security;
drop policy if exists "staff only" on addon_section_templates;
create policy "staff only" on addon_section_templates
  for all to authenticated using (xos_is_staff()) with check (xos_is_staff());
