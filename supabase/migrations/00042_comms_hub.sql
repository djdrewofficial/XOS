-- XOS — Communications Hub (phase 1: HighLevel sync + inbox).
-- Mirrors GHL conversations/messages into XOS, keyed by GHL string ids so
-- re-syncs are idempotent. The sync engine (src/lib/highlevel.ts) polls the
-- LeadConnector API with a watermark; conversations link to XOS clients by
-- cell phone / email, which links them to events.

create table if not exists hl_conversations (
  id text primary key,                     -- GHL conversation id
  hl_contact_id text,
  client_id uuid references clients(id) on delete set null,
  contact_name text,
  phone text,
  email text,
  last_message_at timestamptz,
  last_message_type text,                  -- TYPE_SMS / TYPE_CALL / TYPE_EMAIL / ...
  last_message_direction text,             -- inbound / outbound
  last_message_body text,
  unread_count int not null default 0,     -- GHL's unread counter at last sync
  synced_at timestamptz not null default now()
);
create index if not exists hl_conversations_last_msg_idx on hl_conversations (last_message_at desc);
create index if not exists hl_conversations_client_idx on hl_conversations (client_id);

create table if not exists hl_messages (
  id text primary key,                     -- GHL message id
  conversation_id text not null references hl_conversations(id) on delete cascade,
  direction text,                          -- inbound / outbound
  message_type text,                       -- TYPE_SMS / TYPE_CALL / TYPE_EMAIL / TYPE_VOICEMAIL / ...
  status text,                             -- delivered / failed / read / ...
  body text,
  from_number text,
  to_number text,
  date_added timestamptz,
  meta jsonb,                              -- raw extras (call duration, email ids, attachments)
  synced_at timestamptz not null default now()
);
create index if not exists hl_messages_conv_idx on hl_messages (conversation_id, date_added);

-- single-row sync state (same keyed-boolean pattern as the settings tables)
create table if not exists hl_sync_state (
  id boolean primary key default true check (id),
  last_message_watermark timestamptz,      -- newest message date seen in a completed sync
  last_synced_at timestamptz,
  last_result jsonb
);
insert into hl_sync_state (id) values (true) on conflict (id) do nothing;

alter table hl_conversations enable row level security;
alter table hl_messages enable row level security;
alter table hl_sync_state enable row level security;
do $$ begin
  create policy "authenticated full access" on hl_conversations
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on hl_messages
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on hl_sync_state
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
