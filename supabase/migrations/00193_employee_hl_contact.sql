-- Staff get a HighLevel contact (tagged "XOS Staff") like clients, so their
-- texts/emails thread into a conversation shown on the employee Comms tab.
alter table public.employees add column if not exists hl_contact_id text;
