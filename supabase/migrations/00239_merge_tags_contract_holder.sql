-- Client-facing merge tags name the contract holder (Partner 1), not the
-- primary client (events.client_id). Proposal pages and document generation
-- already resolve the holder in TypeScript; this keeps SQL render_merge_tags
-- (helpers, scheduled emails, offer cover) consistent.
--
-- Selection: event_clients.is_contract_holder. If several, prefer non-Planner
-- role, then is_primary, then oldest created_at. Fall back to events.client_id
-- only when no holder exists.
--
-- Tags affected (same client_* / first_name / authorized_rep_* set as before):
--   <first_name> <last_name> <client_name> <client_email> <client_cell>
--   <client_organization> <client_address>
--   <authorized_rep_name> <authorized_rep_title> <authorized_rep_email> <authorized_rep_phone>
--   plus custom merge_tags rows with source_type = 'client_field'
--
-- UNAPPLIED until Drew approves. App TS paths already apply the holder via
-- renderEventMergeTags / loadEventBundle.

do $mig$
declare
  d text;
  old_line text := $o$select * into c from clients where id = e.client_id;$o$;
  new_block text := $n$select * into c from clients where id = coalesce(
    (
      select ec.client_id
      from event_clients ec
      where ec.event_id = e.id and coalesce(ec.is_contract_holder, false) = true
      order by
        case when lower(coalesce(ec.role, '')) = 'planner' then 1 else 0 end,
        case when coalesce(ec.is_primary, false) then 0 else 1 end,
        ec.created_at nulls last
      limit 1
    ),
    e.client_id
  );$n$;
begin
  d := pg_get_functiondef('public.render_merge_tags(uuid,text)'::regprocedure);
  if position('is_contract_holder, false) = true' in d) > 0
     or position('is_contract_holder = true' in d) > 0 then
    return; -- already applied
  end if;
  if position(old_line in d) = 0 then
    raise exception 'render_merge_tags: client select line not found — not patched';
  end if;
  execute replace(d, old_line, new_block);
end
$mig$;
