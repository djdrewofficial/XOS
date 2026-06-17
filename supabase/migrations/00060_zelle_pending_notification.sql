-- XOS — Zelle "I've sent it" alert.
-- The public pay page (/api/pay/zelle-pending) flags the office when a client
-- marks a Zelle payment as sent, so we can confirm it landed and record it.
-- That call was passing an unrecognized type ('payment') to create_notification,
-- which silently drops anything not in company_settings.notif_types — so no bell
-- alert ever fired. Add a dedicated type and turn it on for existing installs.

-- include in the default allowlist for fresh installs
alter table company_settings alter column notif_types set default array[
  'pending_timesheets', 'assignment_requests', 'time_off_requests',
  'unassigned_pending_payments', 'new_payment_received', 'zelle_pending'
];

-- enable it on the existing (production) settings row
update company_settings
set notif_types = array_append(notif_types, 'zelle_pending')
where id = true and not ('zelle_pending' = any (notif_types));
