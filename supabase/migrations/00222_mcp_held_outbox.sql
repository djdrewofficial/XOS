-- Held outbox rows are not queued, so claim_email_outbox and claim_sms_outbox
-- (which select status = 'queued') cannot send them. A later approval moves
-- the same rows to 'sending' and drains only those ids.

create or replace function public.mcp_outbox_hold_guard()
returns trigger
language plpgsql
as $$
begin
  if current_setting('xos.approval_hold', true) = 'on' and new.status = 'queued' then
    new.status := 'held';
  end if;
  return new;
end;
$$;

drop trigger if exists mcp_email_hold on public.email_log;
create trigger mcp_email_hold
  before insert on public.email_log
  for each row execute function public.mcp_outbox_hold_guard();

drop trigger if exists mcp_sms_hold on public.sms_log;
create trigger mcp_sms_hold
  before insert on public.sms_log
  for each row execute function public.mcp_outbox_hold_guard();

create or replace function public.mcp_run_helper_held(
  p_helper_id uuid,
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('xos.approval_hold', 'on', true);
  perform 1 from public.events where id = p_event_id for update;
  if not found then
    raise exception 'Event was not found.';
  end if;
  perform public.run_booking_helper(p_helper_id, p_event_id);
end;
$$;

revoke all on function public.mcp_run_helper_held(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_run_helper_held(uuid, uuid) to service_role;
