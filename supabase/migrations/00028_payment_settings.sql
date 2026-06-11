-- XOS — payment settings (DJEP Payment Settings parity)
-- Single-row settings table; drives the add-payment form on events.

create table if not exists payment_settings (
  id boolean primary key default true check (id),

  -- PAYMENT METHODS (options when entering a client payment)
  payment_methods text[] not null default array[
    'Cash', 'Credit Card', 'PayPal Invoice', 'Zelle - Xpress Acct', 'Zelle - Drew Acct'
  ],
  -- methods for employee wages / expenses
  expense_payment_methods text[] not null default array[
    'Cash', 'Company Card', 'Check', 'Zelle'
  ],

  -- REASONS FOR PAYMENT
  payment_reasons text[] not null default array[
    'Retainer Fee', 'Additional Payment', 'Additional Addon', 'Final Payment', 'Tip'
  ],
  -- pre-fill the reason field based on how many payments have been made
  -- (index 0 = no payments, 1 = one payment, 2 = two payments); manual payments only
  prefill_reasons text[] not null default array['Deposit', 'Payment 2', 'Payment 3'],

  -- AUTO-FILL AMOUNT WHEN ADDING A PAYMENT
  autofill_no_payments text not null default 'retainer_fee'
    check (autofill_no_payments in ('disabled', 'retainer_fee', 'next_scheduled', 'balance_due')),
  autofill_after_payments text not null default 'disabled'
    check (autofill_after_payments in ('disabled', 'retainer_fee', 'next_scheduled', 'balance_due')),

  -- PAST DUE DATE ADJUSTMENT (0 = final balance due on event date;
  -- positive = N days after the event, negative = N days before)
  past_due_adjust_days int not null default 0,

  updated_at timestamptz not null default now()
);

insert into payment_settings (id) values (true) on conflict (id) do nothing;

alter table payment_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on payment_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- payments.method becomes free text driven by the configured list
alter table payments drop constraint if exists payments_method_check;
-- reason for payment (DJEP parity)
alter table payments add column if not exists reason text;
