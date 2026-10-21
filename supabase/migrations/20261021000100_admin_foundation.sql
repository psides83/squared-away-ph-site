begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- Only trusted SQL / service-role administration can grant administrator access.
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users where user_id = (select auth.uid())); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  email text check (length(email) <= 254),
  phone text check (length(phone) <= 50),
  notes text check (length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.horses (
  id uuid primary key default gen_random_uuid(),
  barn_name text not null check (length(trim(barn_name)) between 1 and 200),
  registered_name text check (length(registered_name) <= 200),
  registration_number text check (length(registration_number) <= 100),
  birth_year smallint check (birth_year between 1900 and 2200),
  sex text not null default 'unknown' check (sex in ('unknown', 'mare', 'gelding', 'stallion')),
  breed text check (length(breed) <= 100),
  training_goals text check (length(training_goals) <= 5000),
  feeding_instructions text check (length(feeding_instructions) <= 5000),
  health_notes text check (length(health_notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ownership relationships are separate from responsibility for a training bill.
-- This table is reserved for the ownership editor in the next increment.
create table public.horse_customers (
  horse_id uuid not null references public.horses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  relationship text not null default 'owner' check (length(relationship) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (horse_id, customer_id)
);
create index horse_customers_customer_idx on public.horse_customers(customer_id);

create table public.training_stays (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete restrict,
  billing_customer_id uuid not null references public.customers(id) on delete restrict,
  arrival_date date not null,
  departure_date date check (departure_date >= arrival_date),
  monthly_rate_cents integer not null check (monthly_rate_cents between 0 and 100000000),
  billing_day smallint not null default 1 check (billing_day between 1 and 28),
  proration text not null default 'manual' check (proration in ('manual', 'calendar_days', 'none')),
  notes text check (length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Both arrival and departure count as days on the premises.
  constraint no_overlapping_training_stays exclude using gist (
    horse_id extensions.gist_uuid_ops with =,
    daterange(arrival_date, departure_date, '[]') with &&
  )
);
create index training_stays_customer_idx on public.training_stays(billing_customer_id);

create table public.reminder_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index reminder_categories_name_idx on public.reminder_categories(lower(trim(name)));

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  horse_id uuid references public.horses(id) on delete set null,
  category_id uuid references public.reminder_categories(id) on delete set null,
  due_date date not null,
  notes text check (length(notes) <= 5000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_due_date_idx on public.reminders(due_date) where completed_at is null;
create index reminders_horse_idx on public.reminders(horse_id);
create index reminders_category_idx on public.reminders(category_id);

insert into public.reminder_categories(name) values
  ('Farrier'), ('Vaccinations'), ('Deworming'), ('Dental'), ('Medications'), ('General');

do $$
declare table_name text;
begin
  foreach table_name in array array['customers', 'horses', 'horse_customers', 'training_stays', 'reminder_categories', 'reminders'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy admin_only on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', table_name);
    if table_name <> 'horse_customers' then
      execute format('create trigger update_timestamp before update on public.%I for each row execute function public.set_updated_at()', table_name);
    end if;
  end loop;
end;
$$;

commit;
