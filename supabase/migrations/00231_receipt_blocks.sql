-- Payment Receipt invoice-style smart block options.
-- Migration number 00231: skip 00230 (reserved for a time-clock PR).
-- Do NOT apply from the agent (no prod migration / no deploy).
--
-- No schema change: block options live in document_templates.blocks jsonb.
-- Updates the Payment Receipt template (prod id 0fae46ca-...) to the
-- invoice-style block set: fee_table (qty + descriptions + heading),
-- payments_received (notes off), summary_box, payment_schedule
-- (unpaid only / hide when paid). Client-facing title stays "Payment Receipt"
-- (never "invoice").

do $seed$
declare
  v_prod uuid := '0fae46ca-0abd-481d-ba3d-579634ea792f';
  v_tpl uuid;
  v_blocks jsonb;
begin
  select id into v_tpl from document_templates
  where id = v_prod or name = 'Payment Receipt'
  order by case when id = v_prod then 0 else 1 end
  limit 1;

  v_blocks := jsonb_build_array(
    jsonb_build_object(
      'id', 'receipt-intro',
      'type', 'text',
      'html', $h$<p>Thank you for your payment. This receipt relates to your booking agreement with Xpress Entertainment.</p>
<p><strong>Client:</strong> &lt;client_name&gt;<br>
<strong>Event:</strong> &lt;event_name&gt;<br>
<strong>Event number:</strong> &lt;event_number&gt;<br>
<strong>Event date:</strong> &lt;event_date_long&gt;<br>
<strong>Date issued:</strong> &lt;current_date&gt;</p>$h$
    ),
    jsonb_build_object(
      'id', 'receipt-fees',
      'type', 'fee_table',
      'options', jsonb_build_object(
        'heading', 'Line Items',
        'showDescriptions', true,
        'showQty', true,
        'totalLabel', 'Total Investment'
      )
    ),
    jsonb_build_object(
      'id', 'receipt-payments',
      'type', 'payments_received',
      'options', jsonb_build_object(
        'heading', 'Payments Received',
        'showNotes', false
      )
    ),
    jsonb_build_object(
      'id', 'receipt-summary',
      'type', 'summary_box',
      'options', jsonb_build_object(
        'heading', 'Summary',
        'totalLabel', 'Total investment',
        'paidLabel', 'Already paid',
        'balanceLabel', 'Balance due',
        'paidInFullLabel', 'Paid in full'
      )
    ),
    jsonb_build_object(
      'id', 'receipt-schedule',
      'type', 'payment_schedule',
      'options', jsonb_build_object(
        'heading', 'Upcoming Payments',
        'onlyUnpaid', true,
        'hideWhenPaidInFull', true
      )
    )
  );

  if v_tpl is null then
    insert into document_templates (
      id, name, doc_type, is_active, fresh_on_attach, pdf_filename,
      header_kicker, title_format, blocks
    ) values (
      v_prod,
      'Payment Receipt',
      'receipt',
      true,
      true,
      'Xpress Receipt - <event_number>',
      'Payment Receipt',
      '{template} - {client}',
      v_blocks
    );
  else
    update document_templates
      set doc_type = 'receipt',
          fresh_on_attach = true,
          pdf_filename = coalesce(nullif(pdf_filename, ''), 'Xpress Receipt - <event_number>'),
          header_kicker = coalesce(nullif(header_kicker, ''), 'Payment Receipt'),
          title_format = coalesce(nullif(title_format, ''), '{template} - {client}'),
          is_active = true,
          blocks = v_blocks,
          updated_at = now()
    where id = v_tpl;
  end if;
end
$seed$;
