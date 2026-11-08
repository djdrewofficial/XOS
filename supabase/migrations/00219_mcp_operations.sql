-- Operation claims for the MCP connector. Apply through the numbered migration
-- history after an explicit approval. Do not paste this as an untracked script.
--
-- Depends on 00217 and 00218.
--
-- booking_helpers and email_templates do not have updated_at in any migration
-- through 00218. Do not select that column. Version those rows by their body
-- and actions content instead.

alter table public.mcp_confirmations
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'executing', 'completed', 'failed', 'uncertain')),
  add column if not exists idempotency_key text;

create unique index if not exists mcp_confirmations_operation_key
  on public.mcp_confirmations (token_id, idempotency_key)
  where idempotency_key is not null;

-- One person, one claim. The token must still be active at this moment.
create or replace function public.mcp_claim_operation(p_id uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  op public.mcp_confirmations%rowtype;
  tok public.mcp_service_tokens%rowtype;
begin
  select * into op from public.mcp_confirmations where id = p_id for update;
  if not found then
    raise exception 'not claimable';
  end if;
  select * into tok from public.mcp_service_tokens where id = op.token_id for update;
  if tok.revoked_at is not null
     or (tok.expires_at is not null and tok.expires_at <= now())
     or (tok.overlap_until is not null and tok.overlap_until <= now()) then
    raise exception 'token inactive';
  end if;
  if op.status <> 'pending' or op.rejected_at is not null or op.used_at is not null or op.expires_at <= now() then
    raise exception 'not claimable';
  end if;
  update public.mcp_confirmations
    set status = 'executing', approved_at = now(), approved_by = p_user
    where id = p_id
    returning * into op;
  return to_jsonb(op);
end;
$$;

revoke all on function public.mcp_claim_operation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_claim_operation(uuid, uuid) to service_role;

-- Make one membership primary while the event row is locked.
create or replace function public.mcp_set_primary_client(p_event_id uuid, p_event_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member public.event_clients%rowtype;
begin
  perform 1 from public.events where id = p_event_id for update;
  select * into member from public.event_clients where id = p_event_client_id and event_id = p_event_id;
  if member.id is null then
    raise exception 'That person is not on this event.';
  end if;
  update public.event_clients set is_primary = false where event_id = p_event_id;
  update public.event_clients set is_primary = true where id = member.id and event_id = p_event_id;
  update public.events set client_id = member.client_id where id = p_event_id;
end;
$$;

revoke all on function public.mcp_set_primary_client(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_set_primary_client(uuid, uuid) to service_role;

-- Move every reference from the losers onto the survivor, then delete the losers,
-- while the survivor row is locked.
create or replace function public.mcp_merge_venues(
  p_survivor uuid,
  p_losers uuid[],
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  loser uuid;
  allowed text[] := array['name','address','city','state','zip','category_id','travel_fee','setup_fee','distance_miles','driving_notes','load_in_details','notes','is_one_time','auto_mileage','contact_name','phone','email','website'];
  key text;
begin
  if p_survivor is null or p_losers is null or cardinality(p_losers) = 0 then
    raise exception 'Name at least one venue to merge away.';
  end if;
  perform 1 from public.venues where id = p_survivor for update;
  if not found then
    raise exception 'Survivor venue was not found.';
  end if;
  foreach loser in array p_losers loop
    if loser = p_survivor then continue; end if;
    perform 1 from public.venues where id = loser for update;
    update public.events set venue_id = p_survivor where venue_id = loser;
    update public.inquiry_sources set venue_id = p_survivor where venue_id = loser;
    update public.venue_contacts set venue_id = p_survivor where venue_id = loser;
    update public.venue_rooms set venue_id = p_survivor where venue_id = loser;
    update public.venue_djep_map set venue_id = p_survivor where venue_id = loser;
    delete from public.venues where id = loser;
  end loop;
  if p_fields is not null then
    foreach key in array allowed loop
      if p_fields ? key then
        execute format('update public.venues set %I = $1 where id = $2', key) using p_fields ->> key, p_survivor;
      end if;
    end loop;
  end if;
end;
$$;

revoke all on function public.mcp_merge_venues(uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.mcp_merge_venues(uuid, uuid[], jsonb) to service_role;

-- Run a helper and return only the outbox rows this transaction inserted.
create or replace function public.mcp_run_helper_claim(
  p_helper_id uuid,
  p_event_id uuid,
  p_sms jsonb
)
returns table(channel text, id uuid, body_sha text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.events where id = p_event_id for update;
  perform public.run_booking_helper(p_helper_id, p_event_id, p_sms);
  return query
    select 'email'::text, email_log.id, encode(sha256(convert_to(coalesce(email_log.body_html, ''), 'UTF8')), 'hex')
    from public.email_log
    where email_log.event_id = p_event_id
      and email_log.status = 'queued'
      and email_log.xmin = txid_current()::xid;
  return query
    select 'sms'::text, sms_log.id, encode(sha256(convert_to(coalesce(sms_log.body, ''), 'UTF8')), 'hex')
    from public.sms_log
    where sms_log.event_id = p_event_id
      and sms_log.status = 'queued'
      and sms_log.xmin = txid_current()::xid;
end;
$$;

revoke all on function public.mcp_run_helper_claim(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_run_helper_claim(uuid, uuid, jsonb) to service_role;
