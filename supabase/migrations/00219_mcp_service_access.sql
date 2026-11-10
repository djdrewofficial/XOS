-- Service identities for the XOS MCP connector.
-- Raw bearer tokens are never stored. token_hash is SHA-256 hex.
-- Do not apply this file from the app. Drew reviews it and applies it.
-- These tables are service-role only. The settings page reads them with the
-- service-role client after a master-admin check, so a staff JWT cannot
-- select the hash.

create table if not exists public.mcp_service_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token_prefix text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  overlap_until timestamptz,
  rotated_from_id uuid references public.mcp_service_tokens (id) on delete set null,
  note text
);

comment on table public.mcp_service_tokens is
  'Non-human MCP credentials. The raw token is shown once at mint and only its hash is stored.';
comment on column public.mcp_service_tokens.overlap_until is
  'Set when this token is rotated. It keeps working until this time, then dies. Null means it has not been rotated.';

create index if not exists mcp_service_tokens_active_idx
  on public.mcp_service_tokens (revoked_at, expires_at);

create table if not exists public.mcp_confirmations (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.mcp_service_tokens (id) on delete cascade,
  tool_name text not null,
  args_hash text not null,
  args jsonb not null,
  preview jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table public.mcp_confirmations is
  'Single-use proof that a risky MCP call was previewed with these exact arguments.';

create index if not exists mcp_confirmations_token_idx
  on public.mcp_confirmations (token_id, created_at desc);

create table if not exists public.mcp_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  token_id uuid,
  token_name text,
  tool_name text,
  args_redacted jsonb,
  status text not null,
  error_code text,
  duration_ms integer,
  confirmation_id uuid,
  idempotency_key text,
  request_id text
);

comment on table public.mcp_audit_log is
  'Every MCP call. Arguments are redacted before insert. Raw tokens are never written.';

create index if not exists mcp_audit_log_created_idx
  on public.mcp_audit_log (created_at desc);
create index if not exists mcp_audit_log_token_idx
  on public.mcp_audit_log (token_id, created_at desc);

create table if not exists public.mcp_idempotency_keys (
  token_id uuid not null references public.mcp_service_tokens (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  tool_name text not null,
  args_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (token_id, idempotency_key)
);

comment on table public.mcp_idempotency_keys is
  'Stores the first result of a write so a retried MCP call does not send or charge twice.';

alter table public.mcp_service_tokens enable row level security;
alter table public.mcp_confirmations enable row level security;
alter table public.mcp_audit_log enable row level security;
alter table public.mcp_idempotency_keys enable row level security;

revoke all on public.mcp_service_tokens from anon, authenticated;
revoke all on public.mcp_confirmations from anon, authenticated;
revoke all on public.mcp_audit_log from anon, authenticated;
revoke all on public.mcp_idempotency_keys from anon, authenticated;
