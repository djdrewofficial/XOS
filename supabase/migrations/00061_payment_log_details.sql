-- XOS — richer payment log + client-reported Zelle claims.
-- The Financials tab now shows a full payment log (method, payer/cardholder
-- name, PayPal confirmation id, fee, status). Client "I've sent my Zelle"
-- claims are recorded as real payments with status='pending' so they show in
-- the log and can be confirmed — but they must NOT count as money received
-- until confirmed, and must NOT fire the "Payment received" bell (the pay page
-- already fires a 'zelle_pending' notification).

-- cardholder / payer / Zelle-sender name shown in the log
alter table payments add column if not exists payer_name text;

-- only an actually-received (approved) payment should announce "Payment received".
-- pending claims are surfaced via the zelle_pending notification + the log.
create or replace function notify_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ev_name text;
begin
  if new.status is distinct from 'approved' then
    return new;
  end if;
  if new.event_id is not null then
    select coalesce(nullif(name, ''), '(unnamed event)') into ev_name from events where id = new.event_id;
    perform create_notification(
      'new_payment_received',
      format('Payment received — $%s', to_char(new.amount, 'FM999,999,990.00')),
      format('%s · %s', coalesce(ev_name, 'event'), new.method),
      '/events/' || new.event_id
    );
  else
    perform create_notification(
      'unassigned_pending_payments',
      format('Unassigned payment — $%s', to_char(new.amount, 'FM999,999,990.00')),
      'Not linked to an event yet — assign it.',
      '/payments'
    );
  end if;
  return new;
end;
$$;
