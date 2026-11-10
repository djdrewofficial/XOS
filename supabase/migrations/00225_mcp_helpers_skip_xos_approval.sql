-- Per-token opt-in: helpers_run may execute without an Agent Access receipt.
-- Off by default. Only a master admin flips it in Settings → Agent Access.
-- Do not apply from the app. Drew reviews and applies.

alter table public.mcp_service_tokens
  add column if not exists helpers_skip_xos_approval boolean not null default false;

comment on column public.mcp_service_tokens.helpers_skip_xos_approval is
  'When true, helpers_run executes immediately without an mcp_confirmations receipt. Other confirm tools keep the receipt. Master admin only. Default false.';
