-- XOS Beta 1 — seed data from the live DJEP instance (spec §4, §10)

-- Statuses with semantic groups
insert into event_statuses (name, color, is_booked_group, is_pending_group, is_lost_sale_group, is_leads_group, sort_order) values
  ('New Lead',          '#F0F0F0', false, false, false, true,  1),
  ('Active Lead',       '#F03030', false, false, false, true,  2),
  ('Active Lead WS',    '#F0F0F0', false, false, false, true,  3),
  ('Ghost Lead',        '#E0E0E0', false, false, true,  true,  4),
  ('Meeting',           '#95CFF0', false, true,  false, false, 5),
  ('Pending',           '#FFFF99', false, true,  false, false, 6),
  ('Proposal Sent',     '#F09CCC', false, true,  false, false, 7),
  ('Contract Sent',     '#FFFF66', false, true,  false, false, 8),
  ('Contract Overdue',  '#FFAF5E', false, true,  false, false, 9),
  ('Late Retainer',     '#F0F0F0', false, true,  false, false, 10),
  ('Booked',            '#97CC9A', true,  false, false, false, 11),
  ('Booked EV',         '#97CC9A', true,  false, false, false, 12),
  ('Booked WL',         '#97CC9A', true,  false, false, false, 13),
  ('Completed',         '#C8F0F0', false, false, false, false, 14),
  ('Cancelled',         '#9C9C9C', false, false, false, false, 15),
  ('Postponed',         '#D0D0D0', false, false, false, false, 16),
  ('Archived',          '#CCCCCC', false, false, false, false, 17),
  ('Lost Sale',         '#CCCCCC', false, false, true,  false, 18),
  ('Requested Info',    '#FFCCCC', false, false, false, false, 19),
  ('Lost Sale Lead',    '#F0F0F0', false, false, true,  false, 20),
  ('Not Available Lead','#F0F0F0', false, false, false, false, 21);

-- Daily scheduled actions (DJEP parity)
insert into daily_status_actions (trigger_type, from_status_id, to_status_id)
select 'event_date_passed', f.id, t.id from event_statuses f, event_statuses t
  where f.name = 'Booked' and t.name = 'Completed';
insert into daily_status_actions (trigger_type, from_status_id, to_status_id)
select 'event_date_passed', f.id, t.id from event_statuses f, event_statuses t
  where f.name = 'Booked EV' and t.name = 'Completed';
insert into daily_status_actions (trigger_type, from_status_id, to_status_id)
select 'contract_due_passed', f.id, t.id from event_statuses f, event_statuses t
  where f.name = 'Contract Sent' and t.name = 'Contract Overdue';
insert into daily_status_actions (trigger_type, from_status_id, to_status_id)
select 'event_date_passed', f.id, t.id from event_statuses f, event_statuses t
  where f.name = 'Active Lead' and t.name = 'Lost Sale Lead';
insert into daily_status_actions (trigger_type, from_status_id, to_status_id)
select 'event_date_passed', f.id, t.id from event_statuses f, event_statuses t
  where f.name = 'Ghost Lead' and t.name = 'Lost Sale Lead';

-- Event types
insert into event_types (name) values
  ('Wedding'), ('Quinceanera'), ('Corporate'), ('Birthday'), ('Sweet 16'),
  ('Bar/Bat Mitzvah'), ('School Event'), ('Holiday Party'), ('Other');

-- Inquiry sources (from DJEP reports)
insert into inquiry_sources (name) values
  ('Villa Toscana Miami'), ('Zola'), ('The Knot'), ('Google'), ('Instagram'),
  ('TikTok'), ('Drew''s TikTok'), ('HoneyBook'), ('Referral - DJ Company'),
  ('Wedding Planner'), ('Repeat Client'), ('Other');

-- Package categories + packages (live pricing from DJEP)
insert into package_categories (name, sort_order) values
  ('Xpress Entertainment Packages', 1),
  ('Villa Toscana Packages', 2),
  ('Uncategorized', 99);

insert into packages (category_id, name, default_price, included_hours, overtime_hourly, overtime_half_hourly, deposit_value, is_hourly, hourly_rate, display_order)
select c.id, p.name, p.price, p.hours, p.ot, p.ot_half, p.deposit, p.is_hourly, p.hourly, p.ord
from (values
  ('Xpress Entertainment Packages', 'The Xpress Package',        1750.00, 6.0, 250.00, 125.00, 500.00, false, 0.00,  10),
  ('Xpress Entertainment Packages', 'The Xperience Package',     2450.00, 0.0, 366.00, 183.00, 500.00, false, 0.00,   9),
  ('Xpress Entertainment Packages', 'The Xperience Plus',        3650.00, 0.0, 550.00, 275.00, 500.00, false, 0.00,   8),
  ('Xpress Entertainment Packages', 'DJ Hourly Rate',               0.00, 0.0,   0.00,   0.00,   0.00, true, 300.00,  0),
  ('Villa Toscana Packages',        'Toscana Xperience Package',  2000.00, 0.0,   0.00,   0.00,   0.00, false, 0.00,  0),
  ('Villa Toscana Packages',        'Toscana Xperience Plus Package', 2900.00, 0.0, 0.00,  0.00,   0.00, false, 0.00,  0),
  ('Uncategorized',                 'No Package / To Be Determined',   0.00, 0.0,  0.00,   0.00,   0.00, false, 0.00,  0)
) as p(cat, name, price, hours, ot, ot_half, deposit, is_hourly, hourly, ord)
join package_categories c on c.name = p.cat;

-- Add-ons (sample from live data)
insert into addons (name, category, default_price) values
  ('LED Dance Floor Rental (18x18)', 'Rentals', 2100.00),
  ('Photo Booth', 'Photo Booth', 500.00),
  ('Cold Sparks', 'Effects', 400.00),
  ('Dancing on the Clouds', 'Effects', 350.00),
  ('Uplighting', 'Lighting', 300.00);
