-- Payment Receipt PDF attachment for the Payment Received email.
--
-- Reuses the existing email_templates.attach_template_id + attach_mode='pdf'
-- pipeline (outboundEnrich). Seeds an editable Document Manager template
-- ("Payment Receipt") and wires the Payment Received email to attach it.
--
-- Also adds:
--   document_templates.fresh_on_attach  - always generate a new doc at send
--     (required for receipts so each payment freezes current merge tags)
--   document_templates.pdf_filename     - merge-tagged attachment filename
--   company_settings document branding  - logo URL, accent, footer (Document shell)
--   <event_number> and <most_recent_payment_notes> merge tags
--
-- Financials-hidden events: money tags blank via render_merge_tags (same as the
-- email body). The PDF still attaches; amounts/methods/fees render blank.
-- Do NOT apply this to production from the agent; commit only.

-- ---- document template columns ----------------------------------------------
alter table public.document_templates
  add column if not exists fresh_on_attach boolean not null default false;

alter table public.document_templates
  add column if not exists pdf_filename text;

-- Allow doc_type = receipt (client label: Payment Receipt; not an invoice type label).
do $chk$
begin
  alter table public.document_templates drop constraint if exists document_templates_doc_type_check;
  alter table public.document_templates
    add constraint document_templates_doc_type_check
    check (doc_type in ('contract', 'quote', 'invoice', 'receipt', 'other'));
exception when others then
  raise notice 'document_templates doc_type check refresh: %', sqlerrm;
end
$chk$;

-- ---- company document branding (editable in Settings → General) -------------
alter table public.company_settings
  add column if not exists document_logo_url text;

alter table public.company_settings
  add column if not exists document_accent_color text not null default '#4b328e';

alter table public.company_settings
  add column if not exists document_footer_text text;

-- ---- extend payment receipt tags with notes/reference -----------------------
drop function if exists public.xos_payment_receipt_tags(uuid);

create or replace function public.xos_payment_receipt_tags(p_event_id uuid)
returns table (
  amount text,
  method text,
  paid_date text,
  fee text,
  fee_line text,
  notes text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_fee numeric;
  v_fee_txt text;
  v_notes text;
begin
  select p.amount, p.method, p.paid_at, coalesce(p.processing_fee, 0) as processing_fee,
         p.notes, p.bank_deposit_ref
    into r
  from payments p
  where p.event_id = p_event_id
    and p.status = 'approved'
    and p.deleted_at is null
  order by p.paid_at desc nulls last, p.created_at desc
  limit 1;

  if not found then
    amount := '';
    method := '';
    paid_date := '';
    fee := '';
    fee_line := '';
    notes := '';
    return next;
    return;
  end if;

  v_fee := coalesce(r.processing_fee, 0);
  v_fee_txt := case when v_fee > 0 then to_char(v_fee, 'FM$999,999,990.00') else '' end;
  v_notes := nullif(trim(coalesce(r.notes, '')), '');
  if v_notes is null then
    v_notes := nullif(trim(coalesce(r.bank_deposit_ref, '')), '');
  end if;

  amount := to_char(coalesce(r.amount, 0), 'FM$999,999,990.00');
  method := xos_format_payment_method(r.method);
  paid_date := coalesce(to_char((r.paid_at at time zone 'America/New_York')::date, 'FMMonth FMDD, YYYY'), '');
  fee := v_fee_txt;
  fee_line := case
    when v_fee > 0 then '<br>Card service fee: <strong>' || v_fee_txt || '</strong>'
    else ''
  end;
  notes := coalesce(v_notes, '');
  return next;
end;
$$;

revoke all on function public.xos_payment_receipt_tags(uuid) from public;
grant execute on function public.xos_payment_receipt_tags(uuid) to authenticated, service_role;

-- ---- picker rows ------------------------------------------------------------
insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values
  ('event_number', 'Event Number', 'Event',
   'The event number (event ID shown in XOS).', 'builtin', null, true, true),
  ('most_recent_payment_notes', 'Latest Payment Notes / Reference', 'Money',
   'Notes on the most recent approved payment, or the bank deposit reference when notes are blank.',
   'builtin', null, true, true)
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      source_type = 'builtin',
      is_builtin = true,
      is_active = true;

-- ---- patch render_merge_tags: event_number ----------------------------------
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<event_name>', xos_html_escape(e.name));$a$;
  addition text := $a$out_text := replace(out_text, '<event_name>', xos_html_escape(e.name));
  out_text := replace(out_text, '<event_number>', coalesce(e.event_number::text, ''));$a$;
begin
  if position('<event_number>' in src) > 0 then
    return;
  end if;
  if strpos(src, anchor) = 0 then
    -- older escape style without xos_html_escape
    anchor := $a$out_text := replace(out_text, '<event_name>', coalesce(e.name, ''));$a$;
    addition := $a$out_text := replace(out_text, '<event_name>', coalesce(e.name, ''));
  out_text := replace(out_text, '<event_number>', coalesce(e.event_number::text, ''));$a$;
  end if;
  if strpos(src, anchor) = 0 then
    raise exception 'render_merge_tags: <event_name> anchor not found for event_number';
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: <event_name> anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- ---- patch render_merge_tags: most_recent_payment_notes ---------------------
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<most_recent_payment_fee_line>',
    coalesce((select t.fee_line from xos_payment_receipt_tags(e.id) t), ''));$a$;
  addition text := $a$out_text := replace(out_text, '<most_recent_payment_fee_line>',
    coalesce((select t.fee_line from xos_payment_receipt_tags(e.id) t), ''));
  out_text := replace(out_text, '<most_recent_payment_notes>',
    xos_html_escape(coalesce((select t.notes from xos_payment_receipt_tags(e.id) t), '')));$a$;
begin
  if position('<most_recent_payment_notes>' in src) > 0 then
    return;
  end if;
  if strpos(src, anchor) = 0 then
    raise exception 'render_merge_tags: most_recent_payment_fee_line anchor not found';
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: most_recent_payment_fee_line anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- Blank notes with the other money tags for hide-financials events.
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  anchor text := $a$out_text := replace(out_text, '<most_recent_payment_fee_line>', '');$a$;
  addition text := $a$out_text := replace(out_text, '<most_recent_payment_fee_line>', '');
    out_text := replace(out_text, '<most_recent_payment_notes>', '');$a$;
begin
  if position(addition in src) > 0 then
    return;
  end if;
  if position(anchor in src) = 0 then
    return;
  end if;
  -- Only patch the early blanking pass (fee_line blanked next to other money blanks).
  -- Prefer the block that also blanks most_recent_payment_amount.
  if position($a$out_text := replace(out_text, '<most_recent_payment_amount>', '');
    out_text := replace(out_text, '<most_recent_payment_method>', '');
    out_text := replace(out_text, '<most_recent_payment_date>', '');
    out_text := replace(out_text, '<most_recent_payment_processing_fee>', '');
    out_text := replace(out_text, '<most_recent_payment_fee_line>', '');$a$ in src) = 0 then
    return;
  end if;
  anchor := $a$out_text := replace(out_text, '<most_recent_payment_amount>', '');
    out_text := replace(out_text, '<most_recent_payment_method>', '');
    out_text := replace(out_text, '<most_recent_payment_date>', '');
    out_text := replace(out_text, '<most_recent_payment_processing_fee>', '');
    out_text := replace(out_text, '<most_recent_payment_fee_line>', '');$a$;
  addition := $a$out_text := replace(out_text, '<most_recent_payment_amount>', '');
    out_text := replace(out_text, '<most_recent_payment_method>', '');
    out_text := replace(out_text, '<most_recent_payment_date>', '');
    out_text := replace(out_text, '<most_recent_payment_processing_fee>', '');
    out_text := replace(out_text, '<most_recent_payment_fee_line>', '');
    out_text := replace(out_text, '<most_recent_payment_notes>', '');$a$;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: hide-financials notes blank anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- ---- seed Payment Receipt document template ---------------------------------
do $seed$
declare
  v_tpl uuid := 'c8e4f1a2-9b3d-4e5f-a6c7-d8e9f0a1b228';
  v_email uuid;
begin
  if not exists (select 1 from document_templates where id = v_tpl)
     and not exists (select 1 from document_templates where name = 'Payment Receipt') then
    insert into document_templates (
      id, name, doc_type, is_active, fresh_on_attach, pdf_filename, blocks
    ) values (
      v_tpl,
      'Payment Receipt',
      'receipt',
      true,
      true,
      'Xpress Receipt - <event_number>',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'receipt-intro',
          'type', 'text',
          'html', $h$<p>Thank you for your payment. This receipt relates to your booking agreement with Xpress Entertainment.</p>$h$
        ),
        jsonb_build_object(
          'id', 'receipt-event',
          'type', 'text',
          'html', $h$<p><strong>Client:</strong> &lt;client_name&gt;<br>
<strong>Event:</strong> &lt;event_name&gt;<br>
<strong>Event number:</strong> &lt;event_number&gt;<br>
<strong>Event date:</strong> &lt;event_date_long&gt;</p>$h$
        ),
        jsonb_build_object(
          'id', 'receipt-payment',
          'type', 'text',
          'html', $h$<p><strong>Payment received</strong><br>
Amount: <strong>&lt;most_recent_payment_amount&gt;</strong><br>
Method: <strong>&lt;most_recent_payment_method&gt;</strong><br>
Date: <strong>&lt;most_recent_payment_date&gt;</strong>
&lt;most_recent_payment_fee_line&gt;</p>
<p>Confirmation / notes: &lt;most_recent_payment_notes&gt;</p>$h$
        ),
        jsonb_build_object(
          'id', 'receipt-totals',
          'type', 'text',
          'html', $h$<p>Investment total: <strong>&lt;total_fee&gt;</strong><br>
Paid to date: <strong>&lt;payments_received&gt;</strong><br>
Remaining balance: <strong>&lt;balance_status&gt;</strong></p>
<p>If anything looks off, reply to this email and we will sort it out.</p>$h$
        )
      )
    );
  else
    -- Ensure existing Payment Receipt (by name or id) has the receipt send flags.
    update document_templates
      set doc_type = coalesce(nullif(doc_type, ''), 'receipt'),
          fresh_on_attach = true,
          pdf_filename = coalesce(nullif(pdf_filename, ''), 'Xpress Receipt - <event_number>'),
          is_active = true,
          updated_at = now()
    where id = v_tpl or name = 'Payment Receipt';

    select id into v_tpl from document_templates
    where name = 'Payment Receipt' or id = v_tpl
    order by case when id = 'c8e4f1a2-9b3d-4e5f-a6c7-d8e9f0a1b228' then 0 else 1 end
    limit 1;
  end if;

  select id into v_tpl from document_templates
  where name = 'Payment Receipt'
  order by case when id = 'c8e4f1a2-9b3d-4e5f-a6c7-d8e9f0a1b228' then 0 else 1 end
  limit 1;

  if v_tpl is null then
    raise exception 'Payment Receipt document template missing after seed';
  end if;

  -- Wire Payment Received email to attach the PDF by default.
  select id into v_email from email_templates where name = 'Payment Received' limit 1;
  if v_email is not null then
    update email_templates
      set attach_template_id = v_tpl,
          attach_mode = 'pdf'
    where id = v_email
      and (attach_template_id is null or attach_template_id = v_tpl);
  end if;
end
$seed$;
