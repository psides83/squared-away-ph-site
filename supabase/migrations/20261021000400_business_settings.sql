begin;

create table public.business_settings (
  singleton boolean primary key default true check (singleton),
  business_phone text check (length(business_phone) <= 50),
  business_email text check (length(business_email) <= 254),
  default_monthly_rate_cents integer check (default_monthly_rate_cents between 0 and 100000000),
  default_billing_day smallint not null default 1 check (default_billing_day between 1 and 28),
  default_proration text not null default 'calendar_days' check (default_proration in ('manual', 'calendar_days', 'none')),
  default_invoice_due_days smallint not null default 0 check (default_invoice_due_days between 0 and 365),
  payment_instructions text check (length(payment_instructions) <= 5000),
  venmo_url text check (length(venmo_url) <= 500 and venmo_url ~ '^https://'),
  paypal_url text check (length(paypal_url) <= 500 and paypal_url ~ '^https://'),
  apple_cash_instructions text check (length(apple_cash_instructions) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.business_settings(singleton) values (true);
alter table public.business_settings enable row level security;
revoke all on public.business_settings from anon, authenticated;
grant select, insert, update on public.business_settings to authenticated;
create policy admin_only on public.business_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create trigger update_timestamp before update on public.business_settings
  for each row execute function public.set_updated_at();

-- Defaults are copied to each new stay. There is deliberately no propagation
-- trigger from business settings to historical agreements.
alter table public.training_stays add column invoice_due_days smallint
  check (invoice_due_days between 0 and 365);
comment on column public.training_stays.invoice_due_days is
  'Payment terms agreed for this stay. Null on legacy records means not recorded; do not infer current defaults.';

commit;
