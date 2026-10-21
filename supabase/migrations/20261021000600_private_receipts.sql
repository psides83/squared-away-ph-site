begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('expense-receipts','expense-receipts',false,3145728,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy expense_receipts_read on storage.objects for select to authenticated
using (bucket_id='expense-receipts' and (select public.is_admin()));
create policy expense_receipts_write on storage.objects for insert to authenticated
with check (bucket_id='expense-receipts' and (select public.is_admin()));
create policy expense_receipts_delete on storage.objects for delete to authenticated
using (bucket_id='expense-receipts' and (select public.is_admin()));

create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(), expense_id uuid not null references public.expenses(id) on delete restrict,
  object_path text not null unique, file_name text not null check (length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 3145728), created_at timestamptz not null default now()
);
create index expense_receipts_expense_idx on public.expense_receipts(expense_id);
alter table public.expense_receipts enable row level security;
revoke all on public.expense_receipts from anon,authenticated;
grant select,insert,delete on public.expense_receipts to authenticated;
create policy admin_only on public.expense_receipts for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

commit;
