begin;
-- One full, reviewed split per expense. No inference from expense categories.
create view public.service_cost_sources with(security_invoker=true) as
select e.id as expense_id,e.vendor,e.expense_date,e.horse_id,e.amount_cents,
 case when rp.id is not null then coalesce((select sum(l.total_cents) from public.inventory_receipt_lines l where l.receipt_id=rp.id and l.kind='expense'),0)
 when exists(select 1 from public.inventory_movements m where m.expense_id=e.id) then 0 else e.amount_cents end::bigint as eligible_cents
from public.expenses e left join public.inventory_receipt_purchases rp on rp.id=e.id where e.voided_at is null;
revoke all on public.service_cost_sources from public,anon,authenticated;
grant select on public.service_cost_sources to authenticated;
create table public.service_cost_allocations (
 id uuid primary key,expense_id uuid not null references public.expenses(id),source_cents bigint not null,
 training_cents bigint not null check(training_cents>=0),board_cents bigint not null check(board_cents>=0),other_cents bigint not null check(other_cents>=0),
 covered_from date not null,covered_to date not null check(covered_to>=covered_from and covered_to-covered_from<=3660),
 reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz,
 check((cleared and training_cents+board_cents+other_cents=0) or (not cleared and source_cents>0 and training_cents+board_cents+other_cents=source_cents))
);
create unique index current_service_cost_allocation on public.service_cost_allocations(expense_id) where retired_at is null;
alter table public.service_cost_allocations enable row level security;
revoke all on public.service_cost_allocations from public,anon,authenticated;
grant select on public.service_cost_allocations to authenticated;
create policy admin_read on public.service_cost_allocations for select to authenticated using((select public.is_admin()));
create function public.set_service_cost_allocation(p_request uuid,p_expense uuid,p_current uuid,p_training bigint,p_board bigint,p_other bigint,p_from date,p_to date,p_reason text,p_clear boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.service_cost_allocations%rowtype; current_id uuid; eligible bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 perform 1 from public.expenses where id=p_expense for update;
 if not found then raise exception 'Expense not found'; end if;
 select * into existing from public.service_cost_allocations where id=p_request;
 if found then
  if row(existing.expense_id,existing.training_cents,existing.board_cents,existing.other_cents,existing.covered_from,existing.covered_to,existing.reason,existing.cleared) is distinct from row(p_expense,p_training,p_board,p_other,p_from,p_to,trim(p_reason),p_clear) then raise exception 'This request was already used with different values'; end if;
  return existing.id;
 end if;
 select id into current_id from public.service_cost_allocations where expense_id=p_expense and retired_at is null;
 if current_id is distinct from p_current then raise exception 'The cost allocation changed. Close and reopen this editor'; end if;
 if p_request is null or p_clear is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Enter a reason and covered dates of at most ten years'; end if;
 if p_training is null or p_board is null or p_other is null or least(p_training,p_board,p_other)<0 or greatest(p_training,p_board,p_other)>100000000 then raise exception 'Enter valid nonnegative cost portions'; end if;
 select eligible_cents into eligible from public.service_cost_sources where expense_id=p_expense;
 if p_clear then
  if current_id is null or p_training+p_board+p_other<>0 or not exists(select 1 from public.service_cost_allocations where id=current_id and covered_from=p_from and covered_to=p_to) then raise exception 'Choose an existing split to clear'; end if;
 else
  if coalesce(eligible,0)<=0 or p_training+p_board+p_other<>eligible then raise exception 'Allocate the full eligible non-inventory cost across training, board and other'; end if;
 end if;
 update public.service_cost_allocations set retired_at=now() where id=current_id;
 insert into public.service_cost_allocations(id,expense_id,source_cents,training_cents,board_cents,other_cents,covered_from,covered_to,reason,cleared,created_by)
 values(p_request,p_expense,coalesce(eligible,0),p_training,p_board,p_other,p_from,p_to,trim(p_reason),p_clear,auth.uid());
 return p_request;
end; $$;
revoke all on function public.set_service_cost_allocation(uuid,uuid,uuid,bigint,bigint,bigint,date,date,text,boolean) from public,anon;
grant execute on function public.set_service_cost_allocation(uuid,uuid,uuid,bigint,bigint,bigint,date,date,text,boolean) to authenticated;

-- Private dated revenue. Every complete source line reconciles to its saved cents.
create view public.dated_service_revenue with(security_invoker=true) as
with sources as (
 select l.id as line_id,l.invoice_id,v.service,v.amount_cents,d.day,
  1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') as weight
 from public.package_line_reporting p join public.invoice_lines l on l.id=p.line_id
 join public.invoice_day_claims d on d.line_id=l.id
 cross join lateral(values('training'::text,p.training_cents),('board',p.board_cents)) v(service,amount_cents)
 where v.service='training' or v.amount_cents>0
 union all
 select l.id,l.invoice_id,'board',l.amount_cents,d.day,1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day')
 from public.invoice_service_days d join public.invoice_lines l on l.id=d.line_id where d.service='boarding'
 union all
 select l.id,l.invoice_id,'board',l.amount_cents,day::date,1::numeric
 from public.invoice_boarding_claims c join public.invoice_lines l on l.id=c.line_id
 cross join lateral generate_series(c.period_from::timestamp,c.period_to::timestamp,interval '1 day') day
), fractions as (
 select *,weight/sum(weight) over(partition by line_id,service) as fraction from sources
), shares as (
 select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from fractions
)
select line_id,invoice_id,service,day,whole+case when row_number() over(partition by line_id,service order by remainder desc,day)<=amount_cents-sum(whole) over(partition by line_id,service) then 1 else 0 end as cents from shares;
revoke all on public.dated_service_revenue from public,anon,authenticated;

create function public.service_profitability(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose valid dates covering at most ten years'; end if;
 with revenue as (
  select d.*,i.status from public.dated_service_revenue d join public.invoices i on i.id=d.invoice_id where i.status in ('draft','issued')
 ), unsupported as (
  select l.id,l.invoice_id,i.invoice_number,l.amount_cents,l.description
  from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  where i.status='issued' and (l.kind='training' or l.billing_category in ('training','boarding'))
   and coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from
   and not exists(select 1 from revenue d where d.line_id=l.id)
 ), adjustments as (
  select a.id,a.invoice_id,v.service,v.amount_cents,sign(a.amount_cents::numeric) as direction
  from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id and i.status='issued'
  join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  cross join lateral(values('training'::text,r.training_cents),('board',r.board_cents)) v(service,amount_cents)
  where v.amount_cents>0 and not exists(select 1 from unsupported u where u.invoice_id=a.invoice_id)
 ), adjustment_days as (
  select a.id,a.invoice_id,a.service,a.amount_cents,a.direction,d.day,sum(d.cents) as weight
  from adjustments a join revenue d on d.invoice_id=a.invoice_id and d.service=a.service and d.status='issued'
  group by a.id,a.invoice_id,a.service,a.amount_cents,a.direction,d.day
 ), adjustment_fractions as (
  select *,case when sum(weight) over(partition by id,service)=0 then 1::numeric/count(*) over(partition by id,service) else weight/sum(weight) over(partition by id,service) end as fraction from adjustment_days
 ), adjustment_shares as (
  select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from adjustment_fractions
 ), dated_adjustments as (
  select *,direction*(whole+case when row_number() over(partition by id,service order by remainder desc,day)<=amount_cents-sum(whole) over(partition by id,service) then 1 else 0 end) as cents from adjustment_shares
 ), unresolved_adjustments as (
  select distinct a.id,a.invoice_id,i.invoice_number from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id
  left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  where i.status='issued' and (exists(select 1 from revenue d where d.invoice_id=i.id and d.day between p_from and p_to) or coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
   and (r.id is null or r.training_cents>0 and not exists(select 1 from dated_adjustments d where d.id=a.id and d.service='training') or r.board_cents>0 and not exists(select 1 from dated_adjustments d where d.id=a.id and d.service='board'))
 ), active_costs as (
  select a.* from public.service_cost_allocations a join public.service_cost_sources s on s.expense_id=a.expense_id and s.eligible_cents=a.source_cents
  where a.retired_at is null and not a.cleared
 ), cost_days as (
  select a.id,v.service,day::date,v.cents/(a.covered_to-a.covered_from+1) as whole,v.cents%(a.covered_to-a.covered_from+1) as remainder,(day::date-a.covered_from) as day_offset
  from active_costs a cross join lateral(values('training'::text,a.training_cents),('board',a.board_cents),('other',a.other_cents)) v(service,cents)
  cross join lateral generate_series(a.covered_from::timestamp,a.covered_to::timestamp,interval '1 day') day
  where a.covered_from<=p_to and a.covered_to>=p_from
 ), unresolved_costs as (
  select s.*,a.id as allocation_id from public.service_cost_sources s left join public.service_cost_allocations a on a.expense_id=s.expense_id and a.retired_at is null
  where s.eligible_cents>0 and (a.id is null or a.cleared or a.source_cents<>s.eligible_cents)
   and (s.expense_date between p_from and p_to or a.covered_from<=p_to and a.covered_to>=p_from)
 ), service_rows as (
  select service,
   coalesce((select sum(cents) from revenue d where d.service=v.service and d.status='issued' and d.day between p_from and p_to),0) as gross_cents,
   coalesce((select sum(cents) from dated_adjustments d where d.service=v.service and d.day between p_from and p_to),0) as adjustment_cents,
   coalesce((select sum(cents) from revenue d where d.service=v.service and d.status='draft' and d.day between p_from and p_to),0) as draft_cents,
   coalesce((select sum(whole+case when day_offset<remainder then 1 else 0 end) from cost_days d where d.service=v.service and d.day between p_from and p_to),0) as cost_cents
  from(values('training'::text),('board')) v(service)
 ) select jsonb_build_object('services',coalesce((select jsonb_agg(to_jsonb(r) order by service desc) from service_rows r),'[]'::jsonb),
 'other_cost_cents',(select coalesce(sum(whole+case when day_offset<remainder then 1 else 0 end),0) from cost_days where service='other' and day between p_from and p_to),
 'unallocated_cost_cents',(select coalesce(sum(eligible_cents),0) from unresolved_costs),
 'unallocated_cost_count',(select count(*) from unresolved_costs),
 'unsupported_revenue_count',(select count(*) from unsupported),
 'unresolved_adjustment_count',(select count(*) from unresolved_adjustments),
 'cost_review',coalesce((select jsonb_agg(to_jsonb(u)) from(select * from unresolved_costs order by expense_date,expense_id limit 25)u),'[]'::jsonb),
 'revenue_review',coalesce((select jsonb_agg(to_jsonb(u)) from(select * from unsupported order by invoice_id,id limit 25)u),'[]'::jsonb),
 'adjustment_review',coalesce((select jsonb_agg(to_jsonb(u)) from(select * from unresolved_adjustments order by invoice_id,id limit 25)u),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.service_profitability(date,date) from public,anon;
grant execute on function public.service_profitability(date,date) to authenticated;
commit;
