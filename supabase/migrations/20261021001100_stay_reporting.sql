begin;
create table public.invoice_reporting_links (
  id uuid primary key, invoice_id uuid not null references public.invoices(id),
  horse_id uuid not null references public.horses(id), stay_id uuid references public.training_stays(id),
  horse_name text not null, reason text not null check(length(trim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
  retired_at timestamptz, retired_reason text
);
create unique index one_active_invoice_reporting_link on public.invoice_reporting_links(invoice_id) where retired_at is null;
create table public.cost_stay_splits (
  id uuid primary key, expense_id uuid not null references public.expenses(id),
  shared_allocation_id uuid references public.expense_allocations(id), horse_id uuid not null references public.horses(id),
  source_amount_cents integer not null check(source_amount_cents>=0),
  submitted_rows jsonb not null, reason text not null check(length(trim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
  retired_at timestamptz, retired_reason text
);
create unique index active_direct_stay_split on public.cost_stay_splits(expense_id) where shared_allocation_id is null and retired_at is null;
create unique index active_shared_stay_split on public.cost_stay_splits(shared_allocation_id,horse_id) where shared_allocation_id is not null and retired_at is null;
create table public.cost_stay_split_lines (
  split_id uuid not null references public.cost_stay_splits(id), stay_id uuid not null references public.training_stays(id),
  amount_cents integer not null check(amount_cents between 1 and 100000000), primary key(split_id,stay_id)
);
do $$ declare t text; begin
  foreach t in array array['invoice_reporting_links','cost_stay_splits','cost_stay_split_lines'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy reporting_admin on public.%I for select to authenticated using(public.is_admin())',t);
  end loop;
end $$;

create view public.reporting_receipts with (security_invoker=true) as
select p.id as payment_id,p.invoice_id,p.paid_on,p.amount_cents,
  coalesce(s.horse_id,r.horse_id) as horse_id,coalesce(i.stay_id,r.stay_id) as stay_id
from public.invoice_payments p join public.invoices i on i.id=p.invoice_id
left join public.training_stays s on s.id=i.stay_id
left join public.invoice_reporting_links r on r.invoice_id=i.id and r.retired_at is null
where i.status='issued' and p.reversed_at is null;
create view public.reporting_cost_sources with (security_invoker=true) as
select e.id as expense_id,null::uuid as shared_allocation_id,e.horse_id,e.amount_cents,e.expense_date,e.paid_on,e.vendor,'direct'::text as kind
from public.expenses e where e.horse_id is not null and e.voided_at is null
union all
select e.id,a.id,l.horse_id,l.amount_cents,e.expense_date,e.paid_on,e.vendor,'shared'::text
from public.expenses e join public.expense_allocations a on a.expense_id=e.id and a.retired_at is null
join public.expense_allocation_lines l on l.allocation_id=a.id
where e.horse_id is null and e.voided_at is null;
grant select on public.reporting_receipts,public.reporting_cost_sources to authenticated;

create function public.set_invoice_reporting_link(p_request uuid,p_invoice uuid,p_horse uuid,p_stay uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.invoices; old public.invoice_reporting_links; h public.horses; s public.training_stays;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_request is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a reporting assignment reason'; end if;
  select * into i from public.invoices where id=p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  select * into old from public.invoice_reporting_links where id=p_request;
  if found then
    if row(old.invoice_id,old.horse_id,old.stay_id,old.reason) is distinct from row(p_invoice,p_horse,p_stay,trim(p_reason)) then raise exception 'This assignment form was already used. Reload before saving another revision.'; end if;
    return old.id;
  end if;
  if i.stay_id is not null or i.status='void' then raise exception 'Only non-voided invoices without a training stay need a reporting assignment'; end if;
  select * into h from public.horses where id=p_horse;
  if not found then raise exception 'Select an existing horse'; end if;
  if p_stay is not null then
    select * into s from public.training_stays where id=p_stay for share;
    if not found or s.horse_id<>h.id or s.billing_customer_id<>i.customer_id then raise exception 'Select a stay for this horse and the invoice billing customer'; end if;
  end if;
  update public.invoice_reporting_links set retired_at=now(),retired_reason='Replaced: '||trim(p_reason) where invoice_id=i.id and retired_at is null;
  insert into public.invoice_reporting_links(id,invoice_id,horse_id,stay_id,horse_name,reason,created_by) values(p_request,i.id,h.id,p_stay,h.barn_name,trim(p_reason),auth.uid());
  return p_request;
end $$;
create function public.clear_invoice_reporting_link(p_invoice uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a reason for clearing the assignment'; end if;
  perform 1 from public.invoices where id=p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  update public.invoice_reporting_links set retired_at=now(),retired_reason=trim(p_reason) where invoice_id=p_invoice and retired_at is null;
end $$;
create function public.save_cost_stay_split(p_request uuid,p_expense uuid,p_allocation uuid,p_horse uuid,p_rows jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.expenses; source_amount integer; old public.cost_stay_splits; n integer; total bigint;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_request is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a cost assignment reason'; end if;
  select * into e from public.expenses where id=p_expense for update;
  if not found then raise exception 'Expense not found'; end if;
  select * into old from public.cost_stay_splits where id=p_request;
  if found then
    if row(old.expense_id,old.shared_allocation_id,old.horse_id,old.submitted_rows,old.reason) is distinct from row(p_expense,p_allocation,p_horse,p_rows,trim(p_reason)) then raise exception 'This cost form was already used. Reload before saving another revision.'; end if;
    return old.id;
  end if;
  select amount_cents into source_amount from public.reporting_cost_sources where expense_id=e.id and horse_id=p_horse and shared_allocation_id is not distinct from p_allocation;
  if not found then raise exception 'Choose a current, non-voided direct horse cost or saved shared-cost portion'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Assign a positive amount to at least one stay, or clear the assignment'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object' or coalesce(r->>'stay_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(r->>'amount_cents','') !~ '^[0-9]{1,9}$') then raise exception 'Invalid stay or cost amount'; end if;
  select count(*),sum((r->>'amount_cents')::bigint) into n,total from jsonb_array_elements(p_rows) r;
  if (select count(distinct r->>'stay_id') from jsonb_array_elements(p_rows) r)<>n then raise exception 'Each stay must appear once'; end if;
  -- Lock stays against simultaneous horse reassignment before retaining their IDs.
  perform 1 from public.training_stays s join jsonb_array_elements(p_rows) r on s.id=(r->>'stay_id')::uuid for share of s;
  if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'amount_cents')::bigint not between 1 and 100000000
    or not exists(select 1 from public.training_stays s where s.id=(r->>'stay_id')::uuid and s.horse_id=p_horse)) then raise exception 'Assign costs only to stays for the source horse'; end if;
  if total>source_amount then raise exception 'Stay assignments cannot exceed the original horse cost'; end if;
  update public.cost_stay_splits set retired_at=now(),retired_reason='Replaced: '||trim(p_reason) where expense_id=e.id and horse_id=p_horse and shared_allocation_id is not distinct from p_allocation and retired_at is null;
  insert into public.cost_stay_splits(id,expense_id,shared_allocation_id,horse_id,source_amount_cents,submitted_rows,reason,created_by) values(p_request,e.id,p_allocation,p_horse,source_amount,p_rows,trim(p_reason),auth.uid());
  insert into public.cost_stay_split_lines(split_id,stay_id,amount_cents) select p_request,(r->>'stay_id')::uuid,(r->>'amount_cents')::integer from jsonb_array_elements(p_rows) r;
  return p_request;
end $$;
create function public.clear_cost_stay_split(p_expense uuid,p_allocation uuid,p_horse uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a reason for clearing the cost assignment'; end if;
  perform 1 from public.expenses where id=p_expense for update;
  if not found then raise exception 'Expense not found'; end if;
  update public.cost_stay_splits set retired_at=now(),retired_reason=trim(p_reason) where expense_id=p_expense and horse_id=p_horse and shared_allocation_id is not distinct from p_allocation and retired_at is null;
end $$;
create function public.guard_stay_reporting_sources() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='expenses' then
    if row(old.amount_cents,old.horse_id,old.expense_date,old.voided_at) is distinct from row(new.amount_cents,new.horse_id,new.expense_date,new.voided_at)
      and exists(select 1 from public.cost_stay_splits where expense_id=old.id and shared_allocation_id is null and retired_at is null) then raise exception 'Clear the stay cost assignment before changing the source expense'; end if;
  else
    if new.horse_id<>old.horse_id and (exists(select 1 from public.cost_stay_split_lines where stay_id=old.id)
      or exists(select 1 from public.invoice_reporting_links where stay_id=old.id)) then raise exception 'A stay used in reporting history cannot be reassigned to another horse'; end if;
    if new.billing_customer_id<>old.billing_customer_id and exists(select 1 from public.invoice_reporting_links where stay_id=old.id and retired_at is null) then raise exception 'Clear invoice reporting assignments before changing the stay billing customer'; end if;
  end if;
  return new;
end $$;
create trigger protect_stay_cost_source before update on public.expenses for each row execute function public.guard_stay_reporting_sources();
create trigger protect_reporting_stay before update on public.training_stays for each row execute function public.guard_stay_reporting_sources();

create view public.reporting_stay_costs with(security_invoker=true) as
select c.expense_id,c.shared_allocation_id,c.horse_id,c.kind,c.paid_on,l.stay_id,l.amount_cents
from public.reporting_cost_sources c join public.cost_stay_splits s on s.expense_id=c.expense_id and s.horse_id=c.horse_id and s.shared_allocation_id is not distinct from c.shared_allocation_id and s.retired_at is null
join public.cost_stay_split_lines l on l.split_id=s.id;
grant select on public.reporting_stay_costs to authenticated;
create function public.stay_cash_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid reporting period of at most ten years'; end if;
  with receipts as (select stay_id,sum(amount_cents)::bigint as amount from public.reporting_receipts where paid_on between p_from and p_to group by stay_id),
  costs as (select stay_id,coalesce(sum(amount_cents) filter(where kind='direct'),0)::bigint as direct_cents,coalesce(sum(amount_cents) filter(where kind='shared'),0)::bigint as shared_cents from public.reporting_stay_costs where paid_on between p_from and p_to group by stay_id),
  rows as (
    select s.id as stay_id,s.horse_id,h.barn_name as horse_name,c.name as customer_name,s.arrival_date,s.departure_date,
      coalesce(r.amount,0) as received_cents,coalesce(k.direct_cents,0) as direct_cents,coalesce(k.shared_cents,0) as shared_cents,
      coalesce(r.amount,0)-coalesce(k.direct_cents,0)-coalesce(k.shared_cents,0) as margin_cents
    from public.training_stays s join public.horses h on h.id=s.horse_id join public.customers c on c.id=s.billing_customer_id left join receipts r on r.stay_id=s.id left join costs k on k.stay_id=s.id
  ) select jsonb_build_object('stays',coalesce((select jsonb_agg(rows order by horse_name,arrival_date,stay_id) from rows),'[]'),
    'unassigned_received_cents',coalesce((select amount from receipts where stay_id is null),0),
    'unassigned_direct_cents',coalesce((select sum(amount_cents) from public.reporting_cost_sources where kind='direct' and paid_on between p_from and p_to),0)-coalesce((select sum(direct_cents) from costs),0),
    'unassigned_shared_cents',coalesce((select sum(amount_cents) from public.reporting_cost_sources where kind='shared' and paid_on between p_from and p_to),0)-coalesce((select sum(shared_cents) from costs),0),
    'unallocated_shared_cents',coalesce((select sum(e.amount_cents) from public.expenses e where e.horse_id is null and e.voided_at is null and e.paid_on between p_from and p_to and not exists(select 1 from public.expense_allocations a where a.expense_id=e.id and a.retired_at is null)),0)) into result;
  return result;
end $$;

create or replace function public.horse_cash_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid reporting period of at most ten years'; end if;
  with received as (
    select horse_id,sum(amount_cents)::bigint as amount from public.reporting_receipts
    where paid_on between p_from and p_to group by horse_id
  ), direct as (
    select horse_id,sum(amount_cents)::bigint as amount from public.expenses where voided_at is null and paid_on between p_from and p_to and horse_id is not null group by horse_id
  ), shared as (
    select l.horse_id,sum(l.amount_cents)::bigint as amount from public.expenses e
    join public.expense_allocations a on a.expense_id=e.id and a.retired_at is null join public.expense_allocation_lines l on l.allocation_id=a.id
    where e.voided_at is null and e.horse_id is null and e.paid_on between p_from and p_to group by l.horse_id
  ), rows as (
    select h.id as horse_id,h.barn_name as horse_name,coalesce(r.amount,0) as received_cents,coalesce(d.amount,0) as direct_cents,coalesce(s.amount,0) as shared_cents,
      coalesce(r.amount,0)-coalesce(d.amount,0)-coalesce(s.amount,0) as margin_cents
    from public.horses h left join received r on r.horse_id=h.id left join direct d on d.horse_id=h.id left join shared s on s.horse_id=h.id
  ) select jsonb_build_object('horses',coalesce((select jsonb_agg(rows order by horse_name,horse_id) from rows),'[]'),
    'unassigned_received_cents',coalesce((select amount from received where horse_id is null),0),
    'unallocated_paid_cents',coalesce((select sum(e.amount_cents) from public.expenses e where e.voided_at is null and e.horse_id is null and e.paid_on between p_from and p_to
      and not exists(select 1 from public.expense_allocations a where a.expense_id=e.id and a.retired_at is null)),0)) into result;
  return result;
end $$;

revoke all on function public.set_invoice_reporting_link(uuid,uuid,uuid,uuid,text),public.clear_invoice_reporting_link(uuid,text),public.save_cost_stay_split(uuid,uuid,uuid,uuid,jsonb,text),public.clear_cost_stay_split(uuid,uuid,uuid,text),public.guard_stay_reporting_sources(),public.stay_cash_report(date,date) from public;
grant execute on function public.set_invoice_reporting_link(uuid,uuid,uuid,uuid,text),public.clear_invoice_reporting_link(uuid,text),public.save_cost_stay_split(uuid,uuid,uuid,uuid,jsonb,text),public.clear_cost_stay_split(uuid,uuid,uuid,text),public.stay_cash_report(date,date) to authenticated;
create function public.reporting_assignment_options() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  return jsonb_build_object('horses',coalesce((select jsonb_agg(x order by barn_name,id) from (select id,barn_name from public.horses) x),'[]'),
    'stays',coalesce((select jsonb_agg(x order by arrival_date desc,id) from (select s.id,s.horse_id,s.billing_customer_id,s.arrival_date,s.departure_date,c.name as customer_name from public.training_stays s join public.customers c on c.id=s.billing_customer_id) x),'[]'));
end $$;
revoke all on function public.reporting_assignment_options() from public;
grant execute on function public.reporting_assignment_options() to authenticated;
create function public.financial_report_bundle(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  return jsonb_build_object('business',public.cash_report(p_from,p_to),'horse',public.horse_cash_report(p_from,p_to),'stay',public.stay_cash_report(p_from,p_to));
end $$;
revoke all on function public.financial_report_bundle(date,date) from public;
grant execute on function public.financial_report_bundle(date,date) to authenticated;
commit;
