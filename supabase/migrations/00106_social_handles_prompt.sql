-- Applied via Supabase MCP. Social-handle collection prompt: per-person IG/TikTok
-- handles, per-account first-seen + prompt-done tracking, company follow links,
-- and SECURITY DEFINER RPCs shared by the web planner and the mobile app.
alter table event_guests add column if not exists instagram text;
alter table event_guests add column if not exists tiktok text;
alter table accounts add column if not exists first_seen_at timestamptz;
alter table accounts add column if not exists social_prompt_done boolean not null default false;
alter table company_settings add column if not exists instagram_url text;
alter table company_settings add column if not exists tiktok_url text;

create or replace function public.social_prompt_state()
returns table(should_show boolean, instagram text, tiktok text, company_instagram text, company_tiktok text)
language plpgsql security definer set search_path = public as $$
declare
  acct accounts%rowtype;
  v_ig text; v_tt text; c_ig text; c_tt text;
begin
  select * into acct from accounts where auth_user_id = auth.uid();
  if not found then
    return query select false, null::text, null::text, null::text, null::text; return;
  end if;
  if acct.first_seen_at is null then
    update accounts set first_seen_at = now() where auth_user_id = auth.uid();
    acct.first_seen_at := now();
  end if;
  if acct.client_id is not null then
    select instagram, tiktok into v_ig, v_tt from clients where id = acct.client_id;
  elsif acct.event_guest_id is not null then
    select instagram, tiktok into v_ig, v_tt from event_guests where id = acct.event_guest_id;
  end if;
  select instagram_url, tiktok_url into c_ig, c_tt from company_settings limit 1;
  return query select
    (acct.account_type in ('client','event_guest')
       and acct.social_prompt_done = false
       and acct.first_seen_at <= now() - interval '24 hours'),
    v_ig, v_tt, c_ig, c_tt;
end $$;

create or replace function public.save_social_handles(p_instagram text, p_tiktok text)
returns void language plpgsql security definer set search_path = public as $$
declare acct accounts%rowtype;
begin
  select * into acct from accounts where auth_user_id = auth.uid();
  if not found then return; end if;
  if acct.client_id is not null then
    update clients set instagram = nullif(btrim(p_instagram),''), tiktok = nullif(btrim(p_tiktok),''), updated_at = now() where id = acct.client_id;
  elsif acct.event_guest_id is not null then
    update event_guests set instagram = nullif(btrim(p_instagram),''), tiktok = nullif(btrim(p_tiktok),'') where id = acct.event_guest_id;
  end if;
  update accounts set social_prompt_done = true, updated_at = now() where auth_user_id = auth.uid();
end $$;

grant execute on function public.social_prompt_state() to authenticated;
grant execute on function public.save_social_handles(text, text) to authenticated;
