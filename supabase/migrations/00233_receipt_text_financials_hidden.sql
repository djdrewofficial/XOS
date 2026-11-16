-- Payment Receipt follow-up: text-block options for financials-hidden events.
-- Migration number 00233 (00232 is time-clock lockdown).
-- Do NOT apply from the agent (no prod migration / no deploy).
--
-- No schema change: options live in document_templates.blocks jsonb.
-- Preserves staff-edited intro HTML; only adds/merges text-block options
-- hideWhenFinancialsHidden + financialsHiddenHtml on the Payment Receipt
-- intro text block (and any other text block that still lacks them).

do $seed$
declare
  v_prod uuid := '0fae46ca-0abd-481d-ba3d-579634ea792f';
  v_tpl uuid;
  v_blocks jsonb;
  v_alt text := $h$<p>Thanks, &lt;first_name&gt;! Here is a summary of the services for your event.</p>
<p><strong>Event:</strong> &lt;event_name&gt;<br>
<strong>Date:</strong> &lt;event_date_long&gt;<br>
<strong>Venue:</strong> &lt;venue_name&gt;</p>$h$;
  v_out jsonb := '[]'::jsonb;
  v_el jsonb;
  v_opts jsonb;
  v_type text;
begin
  select id, blocks into v_tpl, v_blocks from document_templates
  where id = v_prod or name = 'Payment Receipt'
  order by case when id = v_prod then 0 else 1 end
  limit 1;

  if v_tpl is null then
    return;
  end if;

  for v_el in select * from jsonb_array_elements(coalesce(v_blocks, '[]'::jsonb))
  loop
    v_type := v_el->>'type';
    if v_type = 'text' and coalesce(v_el->>'id', '') in ('receipt-intro', '79d4b900-c9c9-4bff-9877-5c821af15994') then
      v_opts := coalesce(v_el->'options', '{}'::jsonb);
      if not (v_opts ? 'hideWhenFinancialsHidden') then
        v_opts := v_opts || jsonb_build_object('hideWhenFinancialsHidden', false);
      end if;
      if not (v_opts ? 'financialsHiddenHtml')
         or nullif(trim(v_opts->>'financialsHiddenHtml'), '') is null then
        v_opts := v_opts || jsonb_build_object('financialsHiddenHtml', v_alt);
      end if;
      v_el := v_el || jsonb_build_object('options', v_opts);
    end if;
    v_out := v_out || jsonb_build_array(v_el);
  end loop;

  update document_templates
    set blocks = v_out,
        updated_at = now()
  where id = v_tpl;
end
$seed$;
