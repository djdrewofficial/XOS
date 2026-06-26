-- Fix: the social_prompt_state RETURNS TABLE output columns (instagram/tiktok)
-- collided with clients/event_guests columns of the same name -> "column reference
-- is ambiguous" at runtime. Qualify the selected columns with table aliases.
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
    select c.instagram, c.tiktok into v_ig, v_tt from clients c where c.id = acct.client_id;
  elsif acct.event_guest_id is not null then
    select g.instagram, g.tiktok into v_ig, v_tt from event_guests g where g.id = acct.event_guest_id;
  end if;
  select cs.instagram_url, cs.tiktok_url into c_ig, c_tt from company_settings cs limit 1;
  return query select
    (acct.account_type in ('client','event_guest')
       and acct.social_prompt_done = false
       and acct.first_seen_at <= now() - interval '24 hours'),
    v_ig, v_tt, c_ig, c_tt;
end $$;
