begin;

create table public.training_entries (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete restrict,
  kind text not null check (kind in ('session', 'note')),
  entry_date date not null,
  title text not null check (length(trim(title)) between 1 and 200),
  notes text not null check (length(trim(notes)) between 1 and 5000),
  duration_minutes smallint check (duration_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_have_no_duration check (kind = 'session' or duration_minutes is null)
);

create index training_entries_horse_date_idx on public.training_entries(horse_id, entry_date desc, created_at desc);
create index training_entries_date_idx on public.training_entries(entry_date desc, created_at desc);

alter table public.training_entries enable row level security;
revoke all on public.training_entries from anon, authenticated;
grant select, insert, update, delete on public.training_entries to authenticated;
create policy admin_only on public.training_entries for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create trigger update_timestamp before update on public.training_entries
  for each row execute function public.set_updated_at();

-- Entries are private to administrators. Future customer updates need a
-- deliberate publishing flow rather than exposing this table to customers.
commit;
