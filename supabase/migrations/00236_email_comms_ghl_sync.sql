-- Track Comms/GHL sync for every outbound email_log row, and resolve the
-- recipient client among event_clients (not only events.client_id).
--
-- Comms UI reads hl_messages (not email_log). processOutbox mirrors each send
-- via recordXosEmailInComms → recordOutboundEmailComms, which writes hl_messages
-- and posts to GHL. These columns let us retry failed GHL posts and label the
-- bubble as scheduled-template / booking-helper / etc.
--
-- Do NOT apply automatically from this agent run — commit only.

alter table public.email_log
  add column if not exists helper_id uuid references public.booking_helpers(id) on delete set null,
  add column if not exists comms_source text,
  add column if not exists comms_source_label text,
  add column if not exists ghl_sync_status text,
  add column if not exists ghl_sync_error text,
  add column if not exists ghl_synced_at timestamptz,
  add column if not exists ghl_message_id text,
  add column if not exists hl_conversation_id text;

alter table public.email_log
  drop constraint if exists email_log_comms_source_check;
alter table public.email_log
  add constraint email_log_comms_source_check
  check (
    comms_source is null
    or comms_source in (
      'scheduled_template',
      'booking_helper',
      'payment_reminder',
      'manual',
      'system',
      'other'
    )
  );

alter table public.email_log
  drop constraint if exists email_log_ghl_sync_status_check;
alter table public.email_log
  add constraint email_log_ghl_sync_status_check
  check (
    ghl_sync_status is null
    or ghl_sync_status in ('pending', 'synced', 'failed', 'skipped')
  );

create index if not exists email_log_ghl_sync_status_idx
  on public.email_log (ghl_sync_status)
  where ghl_sync_status in ('pending', 'failed');

create index if not exists email_log_helper_id_idx
  on public.email_log (helper_id)
  where helper_id is not null;

comment on column public.email_log.helper_id is
  'Booking helper that queued this row (when known). Used for Comms source labels and retries.';
comment on column public.email_log.comms_source is
  'Origin of the send for Comms labelling: scheduled_template | booking_helper | payment_reminder | manual | system | other.';
comment on column public.email_log.comms_source_label is
  'Human-readable Comms label, e.g. "Booking helper: Send Payment Received Receipt".';
comment on column public.email_log.ghl_sync_status is
  'pending/synced/failed/skipped — GHL conversation log status; failures are safe to retry.';
comment on column public.email_log.ghl_sync_error is
  'Last GHL sync error (truncated). Does not block Mailgun delivery.';
comment on column public.email_log.ghl_synced_at is
  'When the email was successfully logged onto the GHL contact conversation.';
comment on column public.email_log.ghl_message_id is
  'GHL message id when logged via inbound/outbound API (not Mailgun id).';
comment on column public.email_log.hl_conversation_id is
  'hl_conversations.id the primary Comms mirror was written to.';

-- Resolve which event-linked client owns an email address (event_clients union).
create or replace function public.xos_resolve_event_client_id(p_event_id uuid, p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ec.client_id
  from event_clients ec
  join clients c on c.id = ec.client_id
  where ec.event_id = p_event_id
    and c.email is not null
    and lower(trim(c.email)) = lower(trim(p_email))
  order by coalesce(ec.is_primary, false) desc, ec.id asc
  limit 1;
$$;

comment on function public.xos_resolve_event_client_id(uuid, text) is
  'Match a recipient email to an event_clients row. Prefer primary when duplicates.';

-- Before insert: if the recipient matches an event_clients email, stamp that
-- client_id (fixes scheduled sends that always wrote events.client_id).
create or replace function public.email_log_resolve_client_before_ins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched uuid;
begin
  if new.event_id is null or new.to_address is null or btrim(new.to_address) = '' then
    return new;
  end if;
  matched := public.xos_resolve_event_client_id(new.event_id, new.to_address);
  if matched is not null then
    new.client_id := matched;
  end if;
  if new.ghl_sync_status is null then
    new.ghl_sync_status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists email_log_resolve_client_before_ins on public.email_log;
create trigger email_log_resolve_client_before_ins
  before insert on public.email_log
  for each row
  execute function public.email_log_resolve_client_before_ins();
