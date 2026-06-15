-- XOS — Client Journey (Phase A): the post-sign "welcome to the family" page
-- with Zelle + PayPal payment options. Everything here is admin-managed
-- (Settings → Payment Settings + Settings → Client Journey).

-- ============ online payment page config (extends payment_settings) ============
alter table payment_settings add column if not exists online_pay_enabled boolean not null default true;
alter table payment_settings add column if not exists paypal_pay_enabled boolean not null default true;
-- card/PayPal convenience fee added on top of the amount owed (Zelle is free)
alter table payment_settings add column if not exists paypal_fee_pct numeric(5,2) not null default 4;
alter table payment_settings add column if not exists zelle_pay_enabled boolean not null default true;
alter table payment_settings add column if not exists zelle_display_name text not null default 'Xpress Entertainment';
alter table payment_settings add column if not exists zelle_handle text;            -- email or phone Zelle is registered to
alter table payment_settings add column if not exists zelle_memo text not null default 'Include your event date in the memo';

-- the PayPal surcharge is tracked separately so a client's balance drops by
-- exactly the amount owed; the fee is what covered the processing cost
alter table payments add column if not exists processing_fee numeric(10,2) not null default 0;

-- ============ welcome-page content (single row, admin-editable) ============
create table if not exists journey_settings (
  id boolean primary key default true check (id),
  welcome_heading text not null default 'Welcome to the Xpress Entertainment family! 🎉',
  welcome_body text not null default
    '<p>We are beyond excited to be part of your celebration, &lt;first_name&gt;! Your booking is locked in — now let''s make it unforgettable.</p><p>Choose how you''d like to take care of your retainer below, and we''ll be in touch with next steps.</p>',
  confetti boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into journey_settings (id) values (true) on conflict (id) do nothing;

alter table journey_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on journey_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;
