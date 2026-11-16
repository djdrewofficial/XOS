-- Per-token opt-in: trusted agents may run most confirm tools without an
-- Agent Access receipt. Off by default. Irreversible tools stay gated in app
-- code even when this flag is on. Only a master admin flips it in
-- Settings → Agent Access. Do not apply from the app. Drew reviews and applies.

alter table public.mcp_service_tokens
  add column if not exists auto_approve boolean not null default false;

comment on column public.mcp_service_tokens.auto_approve is
  'When true (Trusted agent), confirm tools execute immediately without an mcp_confirmations receipt, except irreversible tools which stay gated. Master admin only. Default false.';
