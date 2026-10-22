-- Enforce "venue-paid events never show money to the client" (event_financials_hidden,
-- migration 00198) in the database itself, not just the UI.
--
-- render_merge_tags and run_payment_reminders are patched IN PLACE (prod's
-- definitions are ahead of the repo copies — see 00195): we splice a block into
-- the live text and fail loudly if the anchor isn't there.

do $mig$
declare
  d text;
  anchor text := 'if not found then return out_text; end if;';
  block text := $b$if not found then return out_text; end if;
  -- caller access: staff / service role render any event; a client only their own
  if auth.uid() is not null and not xos_is_staff() and not xos_can_access_event(p_event_id) then
    return '';
  end if;
  -- venue-paid events (Villa Toscana packages, Booked EV …): every money tag renders
  -- blank, and the priced add-on list falls back to the unpriced one
  if event_financials_hidden(e.id) then
    out_text := replace(out_text, '<addon_list_line_breaks>', '<addon_list_no_prices>');
    out_text := replace(out_text, '<package_price>', '');
    out_text := replace(out_text, '<addon_total_price>', '');
    out_text := replace(out_text, '<total_fee>', '');
    out_text := replace(out_text, '<payments_received>', '');
    out_text := replace(out_text, '<balance_due>', '');
    out_text := replace(out_text, '<deposit_value>', '');
    out_text := replace(out_text, '<retainer_amount>', '');
    out_text := replace(out_text, '<retainer_due_date>', '');
    out_text := replace(out_text, '<second_payment_amount>', '');
    out_text := replace(out_text, '<second_payment_date>', '');
    out_text := replace(out_text, '<third_payment_amount>', '');
    out_text := replace(out_text, '<third_payment_date_medium>', '');
    out_text := replace(out_text, '<overtime_rate>', '');
    out_text := replace(out_text, '<discount>', '');
    out_text := replace(out_text, '<billing_terms>', '');
    out_text := replace(out_text, '<pay_link>', '');
    out_text := replace(out_text, '<payment_link>', '');
    out_text := replace(out_text, '<payment_button>', '');
    out_text := replace(out_text, '<quote_summary>', '');
    out_text := replace(out_text, '<payment_plan>', '');
  end if;$b$;
begin
  d := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  if position('event_financials_hidden' in d) = 0 then
    if position(anchor in d) = 0 then
      raise exception 'render_merge_tags: anchor not found — not patched';
    end if;
    execute replace(d, anchor, block);
  end if;

  d := pg_get_functiondef('public.run_payment_reminders()'::regprocedure);
  if position('event_financials_hidden' in d) = 0 then
    if position('where s.due_date is not null' in d) = 0 then
      raise exception 'run_payment_reminders: anchor not found — not patched';
    end if;
    execute replace(d, 'where s.due_date is not null',
      'where s.due_date is not null and not event_financials_hidden(s.event_id)');
  end if;
end
$mig$;

-- Clients/guests can't read money rows for a hidden event (staff unaffected).
-- RESTRICTIVE = ANDed with the existing "read own event …" policies.
drop policy if exists "hide venue-paid financials" on public.payments;
create policy "hide venue-paid financials" on public.payments as restrictive for select to authenticated
  using (xos_is_staff() or not event_financials_hidden(event_id));
drop policy if exists "hide venue-paid financials" on public.scheduled_payments;
create policy "hide venue-paid financials" on public.scheduled_payments as restrictive for select to authenticated
  using (xos_is_staff() or not event_financials_hidden(event_id));
drop policy if exists "hide venue-paid financials" on public.event_addons;
create policy "hide venue-paid financials" on public.event_addons as restrictive for select to authenticated
  using (xos_is_staff() or not event_financials_hidden(event_id));
-- Venue-paid packages (the Toscana price list) are invisible to non-staff entirely.
drop policy if exists "hide venue-paid packages" on public.packages;
create policy "hide venue-paid packages" on public.packages as restrictive for select to authenticated
  using (xos_is_staff() or not hide_financials);
