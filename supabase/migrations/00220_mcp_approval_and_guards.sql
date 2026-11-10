-- Follow-up guards for the MCP connector. Apply this file through the
-- numbered migration history after an explicit approval. Do not paste it
-- as a one-off script.
--
-- Depends on 00219_mcp_service_access.sql.

-- Human approval is recorded on the preview. The agent token cannot set these.
alter table public.mcp_confirmations
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists result jsonb;

comment on column public.mcp_confirmations.approved_by is
  'auth.users id of the person who approved this receipt in XOS. Not an agent token.';

-- Idempotency claims a row before the effect. response stays null while running.
alter table public.mcp_idempotency_keys
  add column if not exists status text not null default 'completed'
    check (status in ('running', 'completed', 'failed', 'uncertain'));
alter table public.mcp_idempotency_keys
  alter column response drop not null;

-- Fail closed and serialize the counter for one bucket/key.
create or replace function public.mcp_rate_hit(
  p_bucket text,
  p_key text,
  p_max int,
  p_window_ms int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || chr(31) || p_key, 0));
  select count(*) into recent
  from public.rate_limit_hits
  where bucket = p_bucket
    and key = p_key
    and created_at > now() - make_interval(secs => p_window_ms / 1000.0);
  if recent >= p_max then
    return true;
  end if;
  insert into public.rate_limit_hits (bucket, key) values (p_bucket, p_key);
  return false;
end;
$$;

revoke all on function public.mcp_rate_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.mcp_rate_hit(text, text, int, int) to service_role;

-- A payment must stay attached to its event. SET NULL left money with no event
-- if a delete slipped past the application count.
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
  where nsp.nspname = 'public'
    and rel.relname = 'payments'
    and att.attname = 'event_id'
    and con.contype = 'f';
  if cname is not null then
    execute format('alter table public.payments drop constraint %I', cname);
  end if;
  alter table public.payments
    add constraint payments_event_id_fkey
    foreign key (event_id) references public.events (id) on delete restrict;
end $$;

-- Remove a membership only when the row belongs to that event, then promote,
-- in one transaction.
create or replace function public.mcp_remove_event_client(p_event_id uuid, p_event_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed public.event_clients%rowtype;
  nxt uuid;
  nxt_client uuid;
  members int;
begin
  perform 1 from public.events where id = p_event_id for update;
  select count(*) into members from public.event_clients where event_id = p_event_id;
  if members <= 1 then
    raise exception 'An event must always have at least one client.';
  end if;
  delete from public.event_clients
  where id = p_event_client_id and event_id = p_event_id
  returning * into removed;
  if removed.id is null then
    raise exception 'That person is not on this event.';
  end if;
  if removed.is_primary then
    select id, client_id into nxt, nxt_client
    from public.event_clients
    where event_id = p_event_id
    order by id
    limit 1;
    if nxt is not null then
      update public.event_clients set is_primary = true where id = nxt and event_id = p_event_id;
      update public.events set client_id = nxt_client where id = p_event_id;
    end if;
  end if;
end;
$$;

revoke all on function public.mcp_remove_event_client(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_remove_event_client(uuid, uuid) to service_role;

-- Drop approval receipts and old idempotency rows. Not scheduled here.
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
end;
$$;

revoke all on function public.mcp_purge_expired() from public, anon, authenticated;
grant execute on function public.mcp_purge_expired() to service_role;

revoke all on public.mcp_service_tokens from public, anon, authenticated;
revoke all on public.mcp_confirmations from public, anon, authenticated;
revoke all on public.mcp_audit_log from public, anon, authenticated;
revoke all on public.mcp_idempotency_keys from public, anon, authenticated;
grant all on public.mcp_service_tokens to service_role;
grant all on public.mcp_confirmations to service_role;
grant all on public.mcp_audit_log to service_role;
grant all on public.mcp_idempotency_keys to service_role;
grant usage, select on sequence public.mcp_audit_log_id_seq to service_role;

-- Daily cleanup. Skipped where pg_cron is not installed (the isolated test database).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('mcp-purge-expired', '15 4 * * *', 'select public.mcp_purge_expired()');
  end if;
end $$;
