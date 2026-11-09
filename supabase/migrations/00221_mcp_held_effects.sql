-- Staff bells, pushes, and helper webhooks that belong to an agent onboarding.
-- They are born held. The outbox cron does not read this table, and it only
-- claims email/SMS rows whose status is queued.

create table if not exists public.mcp_held_effects (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  kind text not null check (kind in ('webhook', 'bell', 'push')),
  payload jsonb not null,
  status text not null default 'held' check (status in ('held', 'sending', 'released')),
  created_at timestamptz not null default now()
);

alter table public.mcp_held_effects enable row level security;
revoke all on public.mcp_held_effects from public, anon, authenticated;
grant select, insert, update on public.mcp_held_effects to service_role;

-- Move the exact approved rows from held to sending, or move none of them.
create or replace function public.mcp_claim_held(
  p_email uuid[],
  p_sms uuid[],
  p_effects uuid[]
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
  select count(*) into email_count from (select id from public.email_log where id = any(coalesce(p_email, '{}')) and status = 'held' for update) locked_email;
  select count(*) into sms_count from (select id from public.sms_log where id = any(coalesce(p_sms, '{}')) and status = 'held' for update) locked_sms;
  select count(*) into effect_count from (select id from public.mcp_held_effects where id = any(coalesce(p_effects, '{}')) and status = 'held' for update) locked_effect;
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

revoke all on function public.mcp_claim_held(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.mcp_claim_held(uuid[], uuid[], uuid[]) to service_role;
