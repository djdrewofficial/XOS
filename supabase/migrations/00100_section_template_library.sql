-- Section Templates library. Reuses the planning-template machinery: a single
-- planning_template flagged is_library=true holds the reusable section templates
-- (edited under Settings → Planner → "Section Templates"). It is NEVER seeded as
-- an event's base template and is hidden from every event-template picker — its
-- sections only land on an event via an add-on mapping (addon_section_templates,
-- migration 00099) or an explicit "add from library".

alter table planning_templates
  add column if not exists is_library boolean not null default false;

-- Ensure exactly one library template exists.
insert into planning_templates (name, is_library)
select 'Section Templates', true
where not exists (select 1 from planning_templates where is_library);
