-- Payment Receipt document type + merge/timezone fixes + attach helpers.
-- Migration number 00229: PR #70 uses 00228; renumber if that lands first or
-- another 00229 appears. Do NOT apply from the agent (no prod migration).
--
-- Adds:
--   doc_type 'receipt' (PDF header kicker defaults to PAYMENT RECEIPT /
--     "Payment Receipt"; editable per template via header_kicker)
--   document_templates.header_kicker, title_format, fresh_on_attach, pdf_filename
--   documents.header_kicker (frozen at generate time)
--   <event_number> merge tag
--   Timezone fixes: midnight-UTC paid_at keeps that calendar date;
--     other paid_at and <current_date> use America/New_York
--   Seeds/updates Payment Receipt template (prod id 0fae46ca-...) with a
--     payments_received smart block and wires Payment Received email attach_mode=pdf

-- ---- columns ----------------------------------------------------------------
alter table public.document_templates
  add column if not exists header_kicker text;

alter table public.document_templates
  add column if not exists title_format text;

alter table public.document_templates
  add column if not exists fresh_on_attach boolean not null default false;

alter table public.document_templates
  add column if not exists pdf_filename text;

alter table public.documents
  add column if not exists header_kicker text;

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

-- ---- payment date helper (midnight UTC = date-only; else America/New_York) --
create or replace function public.xos_format_payment_date(p_paid_at timestamptz)
returns text
language plpgsql
immutable
as $$
declare
  v_utc timestamp;
begin
  if p_paid_at is null then
    return '';
  end if;
  v_utc := p_paid_at at time zone 'UTC';
  if extract(hour from v_utc) = 0
     and extract(minute from v_utc) = 0
     and extract(second from v_utc) = 0 then
    return to_char(v_utc::date, 'FMMonth FMDD, YYYY');
  end if;
  return to_char((p_paid_at at time zone 'America/New_York')::date, 'FMMonth FMDD, YYYY');
end;
$$;

revoke all on function public.xos_format_payment_date(timestamptz) from public;
grant execute on function public.xos_format_payment_date(timestamptz) to authenticated, service_role;

-- ---- receipt tags (notes + timezone-aware paid_date) ------------------------
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
         p.notes, p.reason, p.bank_deposit_ref
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
    v_notes := nullif(trim(coalesce(r.reason, '')), '');
  end if;
  if v_notes is null then
    v_notes := nullif(trim(coalesce(r.bank_deposit_ref, '')), '');
  end if;

  amount := to_char(coalesce(r.amount, 0), 'FM$999,999,990.00');
  method := xos_format_payment_method(r.method);
  paid_date := xos_format_payment_date(r.paid_at);
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

-- ---- merge tag picker rows --------------------------------------------------
insert into public.merge_tags (tag_key, label, group_name, description, source_type, source_value, is_builtin, is_active)
values
  ('event_number', 'Event Number', 'Event',
   'The event number shown in XOS.', 'builtin', null, true, true),
  ('most_recent_payment_notes', 'Latest Payment Notes / Reference', 'Money',
   'Notes on the most recent approved payment, or reason / bank deposit reference when notes are blank.',
   'builtin', null, true, true)
on conflict (tag_key) do update
  set label = excluded.label,
      group_name = excluded.group_name,
      description = excluded.description,
      source_type = 'builtin',
      is_builtin = true,
      is_active = true;

-- ---- patch render_merge_tags: <event_number> --------------------------------
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
    raise exception 'render_merge_tags: <event_name> anchor not found for event_number';
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: <event_name> anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- ---- patch render_merge_tags: <current_date> America/New_York ---------------
do $mig$
declare
  src text := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  old text := $a$out_text := replace(out_text, '<current_date>', to_char(current_date, 'FMMonth FMDD, YYYY'));$a$;
  new text := $a$out_text := replace(out_text, '<current_date>', to_char((now() at time zone 'America/New_York')::date, 'FMMonth FMDD, YYYY'));$a$;
begin
  if position(new in src) > 0 then
    return;
  end if;
  if strpos(src, old) = 0 then
    raise exception 'render_merge_tags: <current_date> UTC anchor not found';
  end if;
  if (length(src) - length(replace(src, old, ''))) / length(old) <> 1 then
    raise exception 'render_merge_tags: <current_date> anchor is not unique';
  end if;
  execute replace(src, old, new);
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
  anchor text;
  addition text;
begin
  if position('<most_recent_payment_notes>' in src) > 0
     and position($a$out_text := replace(out_text, '<most_recent_payment_fee_line>', '');
    out_text := replace(out_text, '<most_recent_payment_notes>', '');$a$ in src) > 0 then
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
  if position(anchor in src) = 0 then
    return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'render_merge_tags: hide-financials notes blank anchor is not unique';
  end if;
  execute replace(src, anchor, addition);
end
$mig$;

-- ---- update / seed Payment Receipt document template ------------------------
do $seed$
declare
  v_prod uuid := '0fae46ca-0abd-481d-ba3d-579634ea792f';
  v_tpl uuid;
  v_email uuid;
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
      'id', 'receipt-payments',
      'type', 'payments_received'
    ),
    jsonb_build_object(
      'id', 'receipt-latest',
      'type', 'text',
      'html', $h$<p><strong>Most recent payment</strong><br>
Amount: <strong>&lt;most_recent_payment_amount&gt;</strong><br>
Method: <strong>&lt;most_recent_payment_method&gt;</strong><br>
Date: <strong>&lt;most_recent_payment_date&gt;</strong>
&lt;most_recent_payment_fee_line&gt;</p>
<p>Confirmation / notes: &lt;most_recent_payment_notes&gt;</p>
<p>If anything looks off, reply to this email and we will sort it out.</p>$h$
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
    v_tpl := v_prod;
  else
    update document_templates
      set doc_type = 'receipt',
          fresh_on_attach = true,
          pdf_filename = coalesce(nullif(pdf_filename, ''), 'Xpress Receipt - <event_number>'),
          header_kicker = coalesce(nullif(header_kicker, ''), 'Payment Receipt'),
          title_format = coalesce(nullif(title_format, ''), '{template} - {client}'),
          is_active = true,
          -- Only replace blocks when still a raw Booking Agreement copy (has signature)
          -- or empty; otherwise leave staff edits alone.
          blocks = case
            when blocks is null
              or jsonb_typeof(blocks) <> 'array'
              or jsonb_array_length(blocks) = 0
              or blocks::text ilike '%"type": "signature"%'
              or blocks::text ilike '%"type":"signature"%'
            then v_blocks
            else blocks
          end,
          updated_at = now()
    where id = v_tpl;
  end if;

  select id into v_email from email_templates where name = 'Payment Received' limit 1;
  if v_email is not null then
    update email_templates
      set attach_template_id = v_tpl,
          attach_mode = 'pdf'
    where id = v_email
      and (attach_template_id is null or attach_template_id = v_tpl
           or attach_mode is distinct from 'pdf');
  end if;
end
$seed$;
