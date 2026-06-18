-- XOS — Planner "modules": purpose-built section types that do more than
-- songs+questions. First module: Vendor Team, which writes the couple's vendor
-- roster straight into the event's vendors / event_vendors (the differentiator).

-- A section can be a typed module. null = a normal songs/questions section.
alter table planning_sections          add column if not exists module text;
alter table planning_template_sections add column if not exists module text;

-- Per-event vendor details the couple fills in (what the DJ/run-sheet needs).
-- The directory vendor (vendors) is still created/linked for reuse.
alter table event_vendors add column if not exists arrival_time   text;
alter table event_vendors add column if not exists contact_name   text;
alter table event_vendors add column if not exists contact_phone  text;
alter table event_vendors add column if not exists contact_email  text;

-- Add a "Your Vendor Team" module section to the Villa Toscana template
-- (slot 2 — between "Let's get started!" and the photo-booth section).
do $$
declare t_id uuid;
begin
  select id into t_id from planning_templates where name = 'Villa Toscana — Wedding' limit 1;
  if t_id is null then return; end if;
  if exists (select 1 from planning_template_sections where template_id = t_id and module = 'vendors') then
    return;
  end if;
  insert into planning_template_sections
    (template_id, title, icon, section_type, module, songs_enabled, questions_enabled, intro, sort_order)
  values
    (t_id, 'Your Vendor Team', '🤝', 'info', 'vendors', false, false,
     'Add everyone working your day — photographer, planner, venue, and more. This goes straight to our team so we''re all in sync.', 2);
end $$;
