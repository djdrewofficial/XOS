-- Runtime guards found by executing the earlier functions against the real
-- outbox checks. `held` was not a legal email/SMS status (23514). The helper
-- claim's output column `id` collided with events.id (42702), and
-- txid_current()::xid is not a valid cast (42846). Venue merge assigned every
-- jsonb value as text (42804). A hash mismatch must not return a row to
-- `queued`, which the cron delivers.

alter table public.email_log drop constraint if exists email_log_status_check;
alter table public.email_log add constraint email_log_status_check
  check (status = any (array['queued','sending','held','blocked','sent','delivered','opened','failed','bounced','complained','cancelled']));

alter table public.sms_log drop constraint if exists sms_log_status_check;
alter table public.sms_log add constraint sms_log_status_check
  check (status = any (array['queued','sending','held','blocked','sent','failed','cancelled','suppressed']));

-- Helper mail must never sit in `queued` where claim_email_outbox / the cron
-- can send it before the approved body hash is checked. Hold on insert (GUC),
-- then in this same transaction move matches to `sending` and mismatches to
-- `blocked`. Rows without an approved hash are blocked, not queued.
drop function if exists public.mcp_run_helper_claim(uuid, uuid, jsonb);

create or replace function public.mcp_run_helper_claim(
  p_helper_id uuid,
  p_event_id uuid,
  p_sms jsonb,
  p_approved_body_sha text[] default '{}'
)
returns table(channel text, id uuid, body_sha text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('xos.approval_hold', 'on', true);
  perform 1 from public.events as locked_event where locked_event.id = p_event_id for update;
  perform public.run_booking_helper(p_helper_id, p_event_id, p_sms);

  update public.email_log
  set
    status = case
      when cardinality(coalesce(p_approved_body_sha, '{}')) > 0
           and encode(sha256(convert_to(coalesce(email_log.body_html, ''), 'UTF8')), 'hex') = any (p_approved_body_sha)
        then 'sending'
      else 'blocked'
    end,
    error = case
      when cardinality(coalesce(p_approved_body_sha, '{}')) > 0
           and encode(sha256(convert_to(coalesce(email_log.body_html, ''), 'UTF8')), 'hex') = any (p_approved_body_sha)
        then email_log.error
      else 'Body is not the approved template. Not returned to the outbox.'
    end
  where email_log.event_id = p_event_id
    and email_log.status in ('queued', 'held')
    and email_log.xmin::text = txid_current()::text;

  update public.sms_log
  set
    status = case
      when cardinality(coalesce(p_approved_body_sha, '{}')) > 0
           and encode(sha256(convert_to(coalesce(sms_log.body, ''), 'UTF8')), 'hex') = any (p_approved_body_sha)
        then 'sending'
      else 'blocked'
    end,
    error = case
      when cardinality(coalesce(p_approved_body_sha, '{}')) > 0
           and encode(sha256(convert_to(coalesce(sms_log.body, ''), 'UTF8')), 'hex') = any (p_approved_body_sha)
        then sms_log.error
      else 'Body is not the approved template. Not returned to the outbox.'
    end
  where sms_log.event_id = p_event_id
    and sms_log.status in ('queued', 'held')
    and sms_log.xmin::text = txid_current()::text;

  return query
    select 'email'::text, email_log.id, encode(sha256(convert_to(coalesce(email_log.body_html, ''), 'UTF8')), 'hex')
    from public.email_log
    where email_log.event_id = p_event_id
      and email_log.status = 'sending'
      and email_log.xmin::text = txid_current()::text;
  return query
    select 'sms'::text, sms_log.id, encode(sha256(convert_to(coalesce(sms_log.body, ''), 'UTF8')), 'hex')
    from public.sms_log
    where sms_log.event_id = p_event_id
      and sms_log.status = 'sending'
      and sms_log.xmin::text = txid_current()::text;
end;
$$;

revoke all on function public.mcp_run_helper_claim(uuid, uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.mcp_run_helper_claim(uuid, uuid, jsonb, text[]) to service_role;

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
  key text;
  raw text;
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
  if p_fields is null then
    return;
  end if;
  foreach key in array array['name','address','city','state','zip','driving_notes','load_in_details','notes','contact_name','phone','email','website'] loop
    if p_fields ? key then
      raw := p_fields ->> key;
      execute format('update public.venues set %I = $1 where id = $2', key) using raw, p_survivor;
    end if;
  end loop;
  foreach key in array array['travel_fee','setup_fee','distance_miles'] loop
    if p_fields ? key then
      raw := p_fields ->> key;
      execute format('update public.venues set %I = $1 where id = $2', key) using nullif(raw, '')::numeric, p_survivor;
    end if;
  end loop;
  if p_fields ? 'category_id' then
    raw := p_fields ->> 'category_id';
    update public.venues set category_id = nullif(raw, '')::uuid where id = p_survivor;
  end if;
  foreach key in array array['is_one_time','auto_mileage'] loop
    if p_fields ? key then
      raw := p_fields ->> key;
      execute format('update public.venues set %I = $1 where id = $2', key) using case when raw is null or raw = '' then null else raw::boolean end, p_survivor;
    end if;
  end loop;
end;
$$;

revoke all on function public.mcp_merge_venues(uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.mcp_merge_venues(uuid, uuid[], jsonb) to service_role;

alter table public.mcp_held_effects add column if not exists payload_sha text;

alter table public.mcp_held_effects drop constraint if exists mcp_held_effects_status_check;
alter table public.mcp_held_effects add constraint mcp_held_effects_status_check
  check (status in ('held', 'sending', 'released', 'blocked'));

drop function if exists public.mcp_claim_held(uuid[], uuid[], uuid[]);

-- Claim held rows only when the body hashes still match the approval.
-- A mismatch raises and leaves every row held. Nothing is moved to queued.
create or replace function public.mcp_claim_held(
  p_email uuid[],
  p_sms uuid[],
  p_effects uuid[],
  p_email_sha text[] default '{}',
  p_sms_sha text[] default '{}',
  p_effect_sha text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  email_count integer;
  sms_count integer;
  effect_count integer;
begin
  select count(*) into email_count from (
    select email_log.id
    from public.email_log
    where email_log.id = any(coalesce(p_email, '{}'))
      and email_log.status = 'held'
      and (cardinality(coalesce(p_email_sha, '{}')) = 0
        or encode(sha256(convert_to(coalesce(email_log.body_html, ''), 'UTF8')), 'hex') = p_email_sha[array_position(p_email, email_log.id)])
    for update
  ) locked_email;
  select count(*) into sms_count from (
    select sms_log.id
    from public.sms_log
    where sms_log.id = any(coalesce(p_sms, '{}'))
      and sms_log.status = 'held'
      and (cardinality(coalesce(p_sms_sha, '{}')) = 0
        or encode(sha256(convert_to(coalesce(sms_log.body, ''), 'UTF8')), 'hex') = p_sms_sha[array_position(p_sms, sms_log.id)])
    for update
  ) locked_sms;
  select count(*) into effect_count from (
    select mcp_held_effects.id
    from public.mcp_held_effects
    where mcp_held_effects.id = any(coalesce(p_effects, '{}'))
      and mcp_held_effects.status = 'held'
      and (cardinality(coalesce(p_effect_sha, '{}')) = 0
        or mcp_held_effects.payload_sha = p_effect_sha[array_position(p_effects, mcp_held_effects.id)])
    for update
  ) locked_effect;
  if email_count <> cardinality(coalesce(p_email, '{}'))
     or sms_count <> cardinality(coalesce(p_sms, '{}'))
     or effect_count <> cardinality(coalesce(p_effects, '{}')) then
    raise exception 'held rows changed';
  end if;
  update public.email_log set status = 'sending' where id = any(coalesce(p_email, '{}')) and status = 'held';
  update public.sms_log set status = 'sending' where id = any(coalesce(p_sms, '{}')) and status = 'held';
  update public.mcp_held_effects set status = 'sending' where id = any(coalesce(p_effects, '{}')) and status = 'held';
end;
$$;

revoke all on function public.mcp_claim_held(uuid[], uuid[], uuid[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.mcp_claim_held(uuid[], uuid[], uuid[], text[], text[], text[]) to service_role;

alter table public.mcp_held_effects drop constraint if exists mcp_held_effects_event_id_fkey;
alter table public.mcp_held_effects
  add constraint mcp_held_effects_event_id_fkey
  foreign key (event_id) references public.events(id) on delete cascade;

create or replace function public.mcp_purge_expired()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.mcp_confirmations where expires_at < now() - interval '14 days';
  delete from public.mcp_idempotency_keys where created_at < now() - interval '14 days';
  delete from public.mcp_audit_log where created_at < now() - interval '180 days';
  delete from public.mcp_held_effects
    where status in ('released', 'blocked')
      and created_at < now() - interval '30 days';
end;
$$;

revoke all on function public.mcp_purge_expired() from public, anon, authenticated;
grant execute on function public.mcp_purge_expired() to service_role;
