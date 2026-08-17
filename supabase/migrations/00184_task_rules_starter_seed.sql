-- Starter task rules mirroring the team's existing Notion board (Request Timeline,
-- CHECK VBO, Make Sure a DJ is Assigned, Ensure the DJ contacted the client, etc.).
-- All ship is_active=false so NOTHING auto-generates until staff review each rule and
-- switch it on in Tasks Manager → Settings. Only seeds when the table is empty, so it
-- never clobbers rules created in the app.
do $seed$
begin
  if exists (select 1 from public.task_rules) then return; end if;

  insert into public.task_rules
    (name, description, is_active, trigger_anchor, offset_days, horizon_days,
     conditions, condition_logic, task_title, task_priority,
     assignee_type, assignee_department, due_offset_days, source)
  values
    ('Send timeline to DJs (4 days before)',
     'Four days before each booked event, remind the team to send the finalized timeline to the assigned DJs.',
     false, 'event_date', -4, null,
     '[{"field":"status_group","op":"is","value":"booked"}]'::jsonb, 'all',
     'Send the event timeline to the DJs for {{event_label}}', 'high',
     'department', 'Production', 0, 'manual'),

    ('Make sure a DJ is assigned',
     'Standing check: any booked upcoming event with no DJ assigned yet needs one.',
     false, 'none', 0, 60,
     '[{"field":"status_group","op":"is","value":"booked"},{"field":"dj_assigned","op":"is_false"}]'::jsonb, 'all',
     'Make sure a DJ is assigned for {{event_label}}', 'high',
     'unassigned', null, -30, 'manual'),

    ('Request timeline from client',
     'Standing check: booked event with no Vibo timeline link yet — request the timeline from the client.',
     false, 'none', 0, 60,
     '[{"field":"status_group","op":"is","value":"booked"},{"field":"has_vibo_link","op":"is_false"}]'::jsonb, 'all',
     'Request Timeline for {{event_label}}', 'normal',
     'unassigned', null, -21, 'manual'),

    ('Confirm DJ has contacted the client',
     'Standing check on booked upcoming events: make sure the assigned DJ has reached out to the client.',
     false, 'none', 0, 45,
     '[{"field":"status_group","op":"is","value":"booked"}]'::jsonb, 'all',
     'Ensure the DJ has communicated with the client for {{event_label}}', 'normal',
     'unassigned', null, -14, 'manual'),

    ('Check VBO timeline',
     'Standing check close to the event: review the Vibo build for each booked upcoming event.',
     false, 'none', 0, 30,
     '[{"field":"status_group","op":"is","value":"booked"}]'::jsonb, 'all',
     'CHECK VBO for {{event_label}}', 'normal',
     'unassigned', null, -7, 'manual'),

    ('Vendor introduction email',
     'Two days after an event is booked, send the vendor introduction email to the client.',
     false, 'booked_date', 2, null,
     '[]'::jsonb, 'all',
     'Send the vendor introduction email for {{event_label}}', 'normal',
     'event_salesperson', null, 0, 'manual');
end $seed$;
