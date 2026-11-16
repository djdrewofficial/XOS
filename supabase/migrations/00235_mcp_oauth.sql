-- MCP OAuth 2.1 for the remote connector (authorization code + PKCE S256).
-- Each connection is per signed-in XOS user (not a separate agent scope model).
-- Reconnecting the same user + client replaces the previous grant.
-- Raw codes and tokens are never stored — only SHA-256 hex hashes.
-- Do not apply this file from the app. Drew reviews it and applies it.

alter table public.mcp_service_tokens
  add column if not exists auth_kind text not null default 'service'
    check (auth_kind in ('service', 'oauth')),
  add column if not exists oauth_client_id text,
  add column if not exists oauth_client_name text,
  add column if not exists approved_by uuid;

comment on column public.mcp_service_tokens.auth_kind is
  'service = mint/rotate bearer secret; oauth = per-user Connect grant.';
comment on column public.mcp_service_tokens.oauth_client_id is
  'RFC 7591 client_id for oauth grants. Null for service tokens.';
comment on column public.mcp_service_tokens.approved_by is
  'Auth user id of the signed-in staff member for an oauth grant.';

create index if not exists mcp_service_tokens_auth_kind_idx
  on public.mcp_service_tokens (auth_kind, revoked_at);

create index if not exists mcp_service_tokens_oauth_user_client_idx
  on public.mcp_service_tokens (approved_by, oauth_client_id)
  where auth_kind = 'oauth' and revoked_at is null;

-- Dynamically registered OAuth clients (RFC 7591).
create table if not exists public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_secret_hash text check (client_secret_hash is null or client_secret_hash ~ '^[0-9a-f]{64}$'),
  client_name text not null check (char_length(btrim(client_name)) between 1 and 200),
  redirect_uris text[] not null check (cardinality(redirect_uris) >= 1),
  grant_types text[] not null default array['authorization_code', 'refresh_token']::text[],
  response_types text[] not null default array['code']::text[],
  token_endpoint_auth_method text not null default 'none'
    check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.mcp_oauth_clients is
  'OAuth clients from dynamic registration. client_secret_hash is null for public clients.';

create index if not exists mcp_oauth_clients_active_idx
  on public.mcp_oauth_clients (revoked_at);

-- Authorization codes (hashed). Single-use; reuse revokes the grant.
create table if not exists public.mcp_oauth_auth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null default '{}',
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  resource text not null,
  grant_token_id uuid not null references public.mcp_service_tokens (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table public.mcp_oauth_auth_codes is
  'Authorization codes stored as SHA-256. used_at set on first redeem; a second redeem revokes the grant.';

create index if not exists mcp_oauth_auth_codes_grant_idx
  on public.mcp_oauth_auth_codes (grant_token_id);

-- Access tokens (hashed). Short-lived; audience-bound to the MCP resource URL.
create table if not exists public.mcp_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  grant_token_id uuid not null references public.mcp_service_tokens (id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  scopes text[] not null default '{}',
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

comment on table public.mcp_oauth_access_tokens is
  'Bearer access tokens for MCP calls. resource is the RFC 8707 audience (MCP URL).';

create index if not exists mcp_oauth_access_tokens_grant_idx
  on public.mcp_oauth_access_tokens (grant_token_id, revoked_at);
create index if not exists mcp_oauth_access_tokens_lookup_idx
  on public.mcp_oauth_access_tokens (token_hash);

-- Refresh tokens (hashed). Rotated on every use.
create table if not exists public.mcp_oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  grant_token_id uuid not null references public.mcp_service_tokens (id) on delete cascade,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  scopes text[] not null default '{}',
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_id uuid references public.mcp_oauth_refresh_tokens (id) on delete set null
);

comment on table public.mcp_oauth_refresh_tokens is
  'Refresh tokens stored as SHA-256. On use the old row is revoked and a new one is issued.';

create index if not exists mcp_oauth_refresh_tokens_grant_idx
  on public.mcp_oauth_refresh_tokens (grant_token_id, revoked_at);
create index if not exists mcp_oauth_refresh_tokens_lookup_idx
  on public.mcp_oauth_refresh_tokens (token_hash);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_auth_codes enable row level security;
alter table public.mcp_oauth_access_tokens enable row level security;
alter table public.mcp_oauth_refresh_tokens enable row level security;

revoke all on public.mcp_oauth_clients from public, anon, authenticated;
revoke all on public.mcp_oauth_auth_codes from public, anon, authenticated;
revoke all on public.mcp_oauth_access_tokens from public, anon, authenticated;
revoke all on public.mcp_oauth_refresh_tokens from public, anon, authenticated;

grant all on public.mcp_oauth_clients to service_role;
grant all on public.mcp_oauth_auth_codes to service_role;
grant all on public.mcp_oauth_access_tokens to service_role;
grant all on public.mcp_oauth_refresh_tokens to service_role;
