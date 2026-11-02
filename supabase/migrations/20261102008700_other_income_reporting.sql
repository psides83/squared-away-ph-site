begin;
create table public.other_income_periods (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),line_id uuid not null,
 horse_id uuid references public.horses(id),stay_id uuid references public.training_stays(id),amount_cents integer not null check(amount_cents between -100000000 and 100000000),
 covered_from date not null,covered_to date not null check(covered_to>=covered_from and covered_to-covered_from<=3660),
 source_token text not null,reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index current_other_income_period on public.other_income_periods(line_id) where retired_at is null;
alter table public.other_income_periods enable row level security;
revoke all on public.other_income_periods from public,anon,authenticated;
grant select on public.other_income_periods to authenticated;
create policy admin_read on public.other_income_periods for select to authenticated using((select public.is_admin()));
create view public.other_income_sources with(security_invoker=true) as
select l.id as line_id,i.id as invoice_id,l.description,l.amount_cents,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.issue_date,i.period_from,i.period_to,c.horse_id,c.stay_id,
 md5(jsonb_build_array(l.id,i.id,l.amount_cents,l.kind,l.billing_category,c.horse_id,c.stay_id)::text) as source_token
from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
where l.kind='manual' and l.billing_category='other' and i.status in ('draft','issued');
revoke all on public.other_income_sources from public,anon,authenticated;
create view public.valid_other_income_periods with(security_invoker=true) as
select s.*,p.id as allocation_id,p.covered_from,p.covered_to from public.other_income_sources s join public.other_income_periods p on p.line_id=s.line_id and p.retired_at is null and not p.cleared
where p.invoice_id=s.invoice_id and p.amount_cents=s.amount_cents and p.horse_id is not distinct from s.horse_id and p.stay_id is not distinct from s.stay_id and p.source_token=s.source_token;
revoke all on public.valid_other_income_periods from public,anon,authenticated;
create function public.set_other_income_period(p_request uuid,p_line uuid,p_current uuid,p_horse uuid,p_stay uuid,p_amount integer,p_from date,p_to date,p_reason text,p_clear boolean,p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.other_income_periods%rowtype;cur public.other_income_periods%rowtype;source public.other_income_sources%rowtype;invoice uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into old from public.other_income_periods where id=p_request;
 if found then invoice:=old.invoice_id;else select invoice_id into invoice from public.invoice_lines where id=p_line;end if;
 perform 1 from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found';end if;
 select * into old from public.other_income_periods where id=p_request;
 if found then
  if row(old.line_id,old.horse_id,old.stay_id,old.amount_cents,old.covered_from,old.covered_to,old.reason,old.cleared,old.source_token) is distinct from row(p_line,p_horse,p_stay,p_amount,p_from,p_to,trim(p_reason),p_clear,p_token) then raise exception 'This request was already used with different values';end if;
  return old.id;
 end if;
 select * into cur from public.other_income_periods where line_id=p_line and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The income period changed. Close and reopen this editor';end if;
 if p_request is null or p_clear is null or p_amount is null or p_amount not between -100000000 and 100000000 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_token is null or length(p_token)<>32 then raise exception 'Enter current source details, covered dates of at most ten years and a private reason';end if;
 if p_clear then
  if cur.id is null or cur.cleared or row(cur.horse_id,cur.stay_id,cur.amount_cents,cur.covered_from,cur.covered_to,cur.source_token) is distinct from row(p_horse,p_stay,p_amount,p_from,p_to,p_token) then raise exception 'Choose the current saved income period to clear';end if;
 else
  if p_stay is not null then perform 1 from public.training_stays where id=p_stay for share;end if;
  select * into source from public.other_income_sources where line_id=p_line;
  if not found then raise exception 'Choose a manual other-income line on a draft or finalized invoice';end if;
  if row(source.horse_id,source.stay_id,source.amount_cents,source.source_token) is distinct from row(p_horse,p_stay,p_amount,p_token) then raise exception 'The invoice assignment or charge changed. Close and reopen this editor';end if;
 end if;
 update public.other_income_periods set retired_at=now() where id=cur.id;
 insert into public.other_income_periods(id,invoice_id,line_id,horse_id,stay_id,amount_cents,covered_from,covered_to,source_token,reason,cleared,created_by)
 values(p_request,invoice,p_line,p_horse,p_stay,p_amount,p_from,p_to,p_token,trim(p_reason),p_clear,auth.uid());
 return p_request;
end;$$;
revoke all on function public.set_other_income_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean,text) from public,anon;
grant execute on function public.set_other_income_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean,text) to authenticated;
create function public.other_income_options(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with rows as (
 select l.id,l.description,l.amount_cents,i.status,i.period_from,i.period_to,c.horse_id,c.stay_id,h.barn_name as horse_name,s.source_token,
 exists(select 1 from public.valid_other_income_periods v where v.line_id=l.id) as valid,
 case when p.id is null then null else to_jsonb(p)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.other_income_periods x where x.line_id=l.id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
 left join public.horses h on h.id=c.horse_id left join public.other_income_sources s on s.line_id=l.id
 left join public.other_income_periods p on p.line_id=l.id and p.retired_at is null
 where i.id=p_invoice and l.kind='manual' and l.billing_category='other'
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rows order by id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.other_income_options(uuid,integer) from public,anon;
grant execute on function public.other_income_options(uuid,integer) to authenticated;
-- Expense details are protected by existing invoice-claim guards; keep the saved original date when present.
create view public.dated_other_income with(security_invoker=true) as
select l.id as line_id,i.id as invoice_id,c.horse_id,c.stay_id,e.expense_date as day,l.amount_cents::numeric as cents,'reimbursement'::text as basis,e.id as expense_id,e.expense_date as covered_from,e.expense_date as covered_to
from public.invoice_expense_claims x join public.invoice_lines l on l.id=x.line_id join public.invoices i on i.id=l.invoice_id
join public.expenses e on e.id=x.expense_id join public.service_invoice_context c on c.invoice_id=i.id
where i.status in ('draft','issued') and l.kind='expense' and l.billing_category='other' and e.voided_at is null
 and (l.source_snapshot->>'expense_date' is null or l.source_snapshot->>'expense_date'=e.expense_date::text)
union all
select p.line_id,p.invoice_id,p.horse_id,p.stay_id,day::date,
 sign(p.amount_cents::numeric)*(floor(abs(p.amount_cents::numeric)/(p.covered_to-p.covered_from+1))+case when day::date-p.covered_from<mod(abs(p.amount_cents::numeric),(p.covered_to-p.covered_from+1)) then 1 else 0 end),
 'manual',null::uuid,p.covered_from,p.covered_to
from public.valid_other_income_periods p cross join lateral generate_series(p.covered_from::timestamp,p.covered_to::timestamp,interval '1 day') day;
revoke all on public.dated_other_income from public,anon,authenticated;
create view public.dated_other_adjustments with(security_invoker=true) as
with sources as (
 select d.* from public.dated_other_income d join public.invoices i on i.id=d.invoice_id where i.status='issued'
), eligible as (
 select a.id,a.invoice_id,r.other_cents::numeric as amount_cents,sign(a.amount_cents::numeric) as direction
 from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id and i.status='issued'
 join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
 where r.other_cents>0 and not exists(select 1 from public.invoice_lines l where l.invoice_id=i.id and l.billing_category='other' and not exists(select 1 from sources d where d.line_id=l.id))
), days as (
 select e.id,e.invoice_id,e.amount_cents,e.direction,d.day,sum(greatest(d.cents,0)) as weight from eligible e join sources d on d.invoice_id=e.invoice_id group by e.id,e.invoice_id,e.amount_cents,e.direction,d.day
), fractions as (
 select *,case when sum(weight) over(partition by id)=0 then 1::numeric/count(*) over(partition by id) else weight/sum(weight) over(partition by id) end as fraction from days
), shares as (
 select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from fractions
)
select id as adjustment_id,invoice_id,day,direction*(whole+case when row_number() over(partition by id order by remainder desc,day)<=amount_cents-sum(whole) over(partition by id) then 1 else 0 end) as cents from shares;
revoke all on public.dated_other_adjustments from public,anon,authenticated;
create function public.other_income_report(p_from date,p_to date,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose valid report dates and a page';end if;
 with sources as materialized(select d.*,i.status from public.dated_other_income d join public.invoices i on i.id=d.invoice_id),
 parts as (
 select s.line_id,s.invoice_id,s.basis,s.expense_id,s.covered_from,s.covered_to,sum(s.cents) as cents
 from sources s where s.day between p_from and p_to group by s.line_id,s.invoice_id,s.basis,s.expense_id,s.covered_from,s.covered_to
 ), rows as (
 select p.*,i.status,i.invoice_number,i.issue_date,coalesce(i.customer_snapshot->>'name',c.name) as customer_name,l.description,l.amount_cents
 from parts p join public.invoices i on i.id=p.invoice_id join public.customers c on c.id=i.customer_id join public.invoice_lines l on l.id=p.line_id
 ), unmatched as (
 select l.id as line_id,i.id as invoice_id,i.invoice_number,i.status,l.description,l.amount_cents,l.kind as source_kind
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
 where i.status in ('draft','issued') and l.billing_category='other' and not exists(select 1 from sources d where d.line_id=l.id)
 and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
  or exists(select 1 from public.other_income_periods p where p.line_id=l.id and p.invoice_id=i.id and p.retired_at is null and p.covered_from<=p_to and p.covered_to>=p_from)
  or exists(select 1 from public.invoice_expense_claims x join public.expenses e on e.id=x.expense_id where x.line_id=l.id and e.expense_date between p_from and p_to)
  or exists(select 1 from sources d where d.invoice_id=i.id and d.day between p_from and p_to)
  or exists(select 1 from public.dated_service_revenue d where d.invoice_id=i.id and d.day between p_from and p_to)
  or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 ), unresolved_adjustments as (
 select a.id as adjustment_id,i.id as invoice_id,i.invoice_number from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id and i.status='issued'
 left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
 where (r.id is null or r.other_cents>0 and not exists(select 1 from public.dated_other_adjustments d where d.adjustment_id=a.id))
  and (r.other_cents>0 or exists(select 1 from public.invoice_lines l where l.invoice_id=i.id and l.billing_category='other'))
  and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from) or exists(select 1 from sources d where d.invoice_id=i.id and d.day between p_from and p_to)
   or exists(select 1 from public.other_income_periods p where p.invoice_id=i.id and p.retired_at is null and p.covered_from<=p_to and p.covered_to>=p_from)
   or exists(select 1 from public.dated_service_revenue d where d.invoice_id=i.id and d.day between p_from and p_to)
   or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 ), dated_adjustments as(select * from public.dated_other_adjustments where day between p_from and p_to)
 select jsonb_build_object('count',(select count(*) from rows),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by covered_from,invoice_id,line_id) from(select * from rows order by covered_from,invoice_id,line_id limit 25 offset (p_page-1)*25)x),'[]'::jsonb),
 'totals',(select jsonb_build_object('reimbursement_cents',coalesce(sum(cents) filter(where status='issued' and basis='reimbursement'),0),'manual_cents',coalesce(sum(cents) filter(where status='issued' and basis='manual'),0),'gross_cents',coalesce(sum(cents) filter(where status='issued'),0),'draft_cents',coalesce(sum(cents) filter(where status='draft'),0),'adjustment_cents',(select coalesce(sum(cents),0) from dated_adjustments),'net_cents',coalesce(sum(cents) filter(where status='issued'),0)+(select coalesce(sum(cents),0) from dated_adjustments)) from rows),
 'unmatched_count',(select count(*) from unmatched),'unmatched_issued_count',(select count(*) from unmatched where status='issued'),
 'unmatched',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from unmatched order by invoice_id,line_id limit 25)x),'[]'::jsonb),
 'unresolved_adjustment_count',(select count(*) from unresolved_adjustments),
 'adjustment_review',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from unresolved_adjustments order by invoice_id,adjustment_id limit 25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.other_income_report(date,date,integer) from public,anon;
grant execute on function public.other_income_report(date,date,integer) to authenticated;
commit;
