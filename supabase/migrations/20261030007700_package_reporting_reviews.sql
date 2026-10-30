begin;
create table public.package_reporting_reviews (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),line_id uuid not null,
 stay_id uuid not null references public.training_stays(id),horse_id uuid not null references public.horses(id),
 amount_cents integer not null check(amount_cents between 0 and 100000000),
 feed_cents integer not null check(feed_cents>=0),board_cents integer not null check(board_cents>=0),
 training_cents integer generated always as(amount_cents-feed_cents-board_cents) stored,
 feed_included boolean not null,board_included boolean not null,
 reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz,
 check(feed_cents::bigint+board_cents<=amount_cents),check(feed_cents=0 or feed_included),check(board_cents=0 or board_included)
);
create unique index current_package_reporting_review on public.package_reporting_reviews(line_id) where retired_at is null;
alter table public.package_reporting_reviews enable row level security;
revoke all on public.package_reporting_reviews from public,anon,authenticated;
grant select on public.package_reporting_reviews to authenticated;
create policy admin_read on public.package_reporting_reviews for select to authenticated using((select public.is_admin()));
-- Original generated snapshots remain untouched. A deliberate current review can override reporting only.
create view public.effective_package_reporting with(security_invoker=true) as
select p.line_id,p.agreement_id,p.feed_cents,p.board_cents,p.training_cents,p.feed_included,p.board_cents>0 as board_included,null::uuid as review_id
from public.package_line_reporting p join public.invoice_lines l on l.id=p.line_id
where not exists(select 1 from public.package_reporting_reviews r where r.line_id=p.line_id and r.invoice_id=l.invoice_id and r.retired_at is null and not r.cleared)
union all
select r.line_id,null::uuid,r.feed_cents,r.board_cents,r.training_cents,r.feed_included,r.board_included,r.id
from public.package_reporting_reviews r join public.invoice_lines l on l.id=r.line_id
join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=i.stay_id
where r.retired_at is null and not r.cleared and r.invoice_id=i.id and r.stay_id=i.stay_id and r.horse_id=s.horse_id
 and r.amount_cents=l.amount_cents and l.kind='training'
 and exists(select 1 from public.invoice_day_claims d where d.line_id=l.id and d.stay_id=s.id);
revoke all on public.effective_package_reporting from public,anon,authenticated;
grant select on public.effective_package_reporting to authenticated;
create function public.set_package_reporting_review(p_request uuid,p_line uuid,p_current uuid,p_horse uuid,p_stay uuid,p_amount integer,p_feed integer,p_board integer,p_feed_included boolean,p_board_included boolean,p_reason text,p_clear boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.package_reporting_reviews%rowtype; current_row public.package_reporting_reviews%rowtype;
 l public.invoice_lines%rowtype;i public.invoices%rowtype;s public.training_stays%rowtype;invoice uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into prior from public.package_reporting_reviews where id=p_request;
 if found then invoice:=prior.invoice_id; else select invoice_id into invoice from public.invoice_lines where id=p_line; end if;
 select * into i from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found'; end if;
 if prior.id is not null then
  if row(prior.line_id,prior.horse_id,prior.stay_id,prior.amount_cents,prior.feed_cents,prior.board_cents,prior.feed_included,prior.board_included,prior.reason,prior.cleared) is distinct from row(p_line,p_horse,p_stay,p_amount,p_feed,p_board,p_feed_included,p_board_included,trim(p_reason),p_clear) then raise exception 'This request was already used with different values'; end if;
  return prior.id;
 end if;
 select * into current_row from public.package_reporting_reviews where line_id=p_line and retired_at is null;
 if current_row.id is distinct from p_current then raise exception 'The reporting split changed. Close and reopen this editor'; end if;
 if p_request is null or p_clear is null or p_amount is null or p_feed is null or p_board is null or p_feed_included is null or p_board_included is null or p_amount<0 or least(p_feed,p_board)<0 or p_feed::bigint+p_board>p_amount or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter feed and board portions within the saved line amount and a private reason'; end if;
 if p_clear then
  if current_row.id is null or current_row.cleared or row(current_row.horse_id,current_row.stay_id,current_row.amount_cents,current_row.feed_cents,current_row.board_cents,current_row.feed_included,current_row.board_included) is distinct from row(p_horse,p_stay,p_amount,p_feed,p_board,p_feed_included,p_board_included) then raise exception 'Choose the current review to clear'; end if;
 else
  select * into l from public.invoice_lines where id=p_line;
  select * into s from public.training_stays where id=i.stay_id for share;
  if l.id is null or l.kind<>'training' or i.status not in ('draft','issued') or s.id is null or row(s.id,s.horse_id,l.amount_cents) is distinct from row(p_stay,p_horse,p_amount) then raise exception 'Choose an unchanged generated training line on a draft or finalized stay invoice'; end if;
  if not exists(select 1 from public.invoice_day_claims d where d.line_id=l.id and d.stay_id=s.id) then raise exception 'Saved training days are required before this line can be allocated'; end if;
 end if;
 update public.package_reporting_reviews set retired_at=now() where id=current_row.id;
 insert into public.package_reporting_reviews(id,invoice_id,line_id,stay_id,horse_id,amount_cents,feed_cents,board_cents,feed_included,board_included,reason,cleared,created_by)
 values(p_request,i.id,p_line,p_stay,p_horse,p_amount,p_feed,p_board,p_feed_included,p_board_included,trim(p_reason),p_clear,auth.uid());
 return p_request;
end; $$;
revoke all on function public.set_package_reporting_review(uuid,uuid,uuid,uuid,uuid,integer,integer,integer,boolean,boolean,text,boolean) from public,anon;
grant execute on function public.set_package_reporting_review(uuid,uuid,uuid,uuid,uuid,integer,integer,integer,boolean,boolean,text,boolean) to authenticated;
create function public.package_review_options(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page'; end if;
 with rows as (
 select l.id,l.description,l.amount_cents,i.status,i.stay_id,s.horse_id,h.barn_name as horse_name,
  (select count(*) from public.invoice_day_claims d where d.line_id=l.id and d.stay_id=s.id) as day_count,
  (select min(day) from public.invoice_day_claims d where d.line_id=l.id and d.stay_id=s.id) as first_day,
  (select max(day) from public.invoice_day_claims d where d.line_id=l.id and d.stay_id=s.id) as last_day,
  (select to_jsonb(p) from public.package_line_reporting p where p.line_id=l.id) as original,
  (select to_jsonb(p) from public.effective_package_reporting p where p.line_id=l.id) as effective,
  case when r.id is null then null else to_jsonb(r)-'created_by' end as current,
  coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.package_reporting_reviews x where x.line_id=l.id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
 left join public.training_stays s on s.id=i.stay_id left join public.horses h on h.id=s.horse_id
 left join public.package_reporting_reviews r on r.line_id=l.id and r.retired_at is null
 where i.id=p_invoice and l.kind='training'
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rows order by id offset (p_page-1)*25 limit 25)x),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.package_review_options(uuid,integer) from public,anon;
grant execute on function public.package_review_options(uuid,integer) to authenticated;
create or replace function public.package_revenue_report(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of at most ten years'; end if;
 with lines as (
 select l.id,l.invoice_id,i.invoice_number,i.issue_date,h.barn_name as horse_name,l.amount_cents,
 p.feed_cents,p.board_cents,p.training_cents,
 exists(select 1 from public.invoice_adjustments a where a.invoice_id=i.id) as has_adjustments
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
 left join public.training_stays s on s.id=i.stay_id left join public.horses h on h.id=s.horse_id
 left join public.effective_package_reporting p on p.line_id=l.id
 where i.status='issued' and l.kind='training' and i.issue_date between p_from and p_to
 ) select jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(x) order by issue_date,invoice_id,id) from lines x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'invoice_id',a.invoice_id,'invoice_number',i.invoice_number,'amount_cents',a.amount_cents,'adjustment_date',a.adjustment_date,'description',a.description,'allocation',case when r.id is null then null else to_jsonb(r)-'created_by'-'retired_at' end) order by a.adjustment_date,a.id) from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null where i.status='issued' and i.issue_date between p_from and p_to and exists(select 1 from lines l where l.invoice_id=i.id)),'[]'::jsonb),
 'totals',(select jsonb_build_object('feed_cents',coalesce(sum(feed_cents),0),'board_cents',coalesce(sum(board_cents),0),'training_cents',coalesce(sum(training_cents),0),'unallocated_cents',coalesce(sum(amount_cents) filter(where feed_cents is null),0)) from lines)) into result;
 return result;
end; $$;
revoke all on function public.package_revenue_report(date,date) from public,anon;
grant execute on function public.package_revenue_report(date,date) to authenticated;
create or replace view public.dated_service_revenue with(security_invoker=true) as
with sources as (
 select l.id as line_id,l.invoice_id,v.service,v.amount_cents,d.day,
  1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') as weight
 from public.effective_package_reporting p join public.invoice_lines l on l.id=p.line_id
 join public.invoice_day_claims d on d.line_id=l.id
 cross join lateral(values('training'::text,p.training_cents),('board',p.board_cents)) v(service,amount_cents)
 where v.service='training' or v.amount_cents>0 or p.board_included is true
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

create or replace function public.feed_charge_comparison(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of at most ten years'; end if;
 with feeding as (
  -- Compare original service dates. A later reversal restates the original feeding.
  select m.*,-m.value_delta_cents as cost_cents from public.inventory_movements m
  where m.kind='feeding' and m.movement_date between p_from and p_to
  and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)
 ), charge_sources as (
  select l.id as line_id,i.id as invoice_id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,
   i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,d.day as service_date,
   1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') as weight,
   d.day::text as tie_key,'monthly'::text as basis
  from public.invoice_service_days d join public.invoice_lines l on l.id=d.line_id
  join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=d.stay_id
  where d.service='feed' and l.billing_category='feed' and i.status in ('draft','issued')

  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,m.movement_date,
   greatest(-m.value_delta_cents,0),m.id::text,'actual_cost'
  from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id
  join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id
  join public.training_stays s on s.id=c.stay_id
  where l.billing_category='feed' and i.status in ('draft','issued')

  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,p.feed_cents,s.horse_id,d.day,
   1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day'),d.day::text,'package'
  from public.effective_package_reporting p join public.invoice_lines l on l.id=p.line_id
  join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=i.stay_id
  join public.invoice_day_claims d on d.line_id=l.id
  where i.status in ('draft','issued') and (p.feed_cents>0 or p.feed_included is true)
  union all
  select m.line_id,m.invoice_id,m.status,m.invoice_number,m.customer_id,m.customer_snapshot,m.period_from,m.period_to,m.issue_date,m.amount_cents,m.horse_id,day::date,
   1::numeric,day::date::text,'manual_period'
  from public.valid_manual_feed_periods m cross join lateral generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day
 ), weighted as (
  select *,case when sum(weight) over(partition by line_id)=0 then 1::numeric/count(*) over(partition by line_id)
   else weight/sum(weight) over(partition by line_id) end as fraction from charge_sources
 ), shares as (
  select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from weighted
 ), allocated as (
  -- Largest remainder reconciles every saved line to exact cents, with stable ties.
  select *,whole+case when row_number() over(partition by line_id order by remainder desc,service_date,tie_key)
    <=amount_cents-sum(whole) over(partition by line_id) then 1 else 0 end as cents from shares
 ), unsupported_invoices as (
  select distinct l.invoice_id from public.invoice_lines l
  where l.billing_category='feed' and not exists(select 1 from charge_sources c where c.line_id=l.id)
 ), adjustment_days as (
  select a.id as adjustment_id,c.invoice_id,c.horse_id,c.service_date,
   r.feed_cents::bigint as amount_cents,
   sign(a.amount_cents::numeric) as direction,sum(c.cents) as weight
  from public.invoice_adjustments a join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  join allocated c on c.invoice_id=a.invoice_id and c.status='issued'
  where r.feed_cents>0 and not exists(select 1 from unsupported_invoices u where u.invoice_id=a.invoice_id)
  group by a.id,c.invoice_id,c.horse_id,c.service_date,r.feed_cents
 ), adjustment_fractions as (
  select *,case when sum(weight) over(partition by adjustment_id)=0 then 1::numeric/count(*) over(partition by adjustment_id)
   else weight/sum(weight) over(partition by adjustment_id) end as fraction from adjustment_days
 ), adjustment_shares as (
  select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from adjustment_fractions
 ), dated_adjustments as (
  select *,direction*(whole+case when row_number() over(partition by adjustment_id order by remainder desc,service_date,horse_id)
   <= amount_cents-sum(whole) over(partition by adjustment_id) then 1 else 0 end) as cents from adjustment_shares
 ), all_charges as (
  select * from allocated
  union all
  select da.adjustment_id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,
   da.amount_cents,da.horse_id,da.service_date,da.weight,da.service_date::text,'adjustment',da.fraction,da.whole,da.remainder,da.cents
  from dated_adjustments da join public.invoices i on i.id=da.invoice_id
 ), period_charges as (select * from all_charges where service_date between p_from and p_to),
 horse_cost as (
  select horse_id,round(sum(cost_cents)) as cost_cents,count(*) as feeding_lines,count(distinct movement_date) as feeding_days,
   round(coalesce(sum(cost_cents) filter(where exists(select 1 from public.training_stays s where s.horse_id=feeding.horse_id and s.feed_billing='at_cost' and feeding.movement_date>=s.arrival_date and (s.departure_date is null or feeding.movement_date<=s.departure_date))
    and not exists(select 1 from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id where c.movement_id=feeding.id and i.status in ('draft','issued'))),0)) as unbilled_actual_cents
  from feeding group by horse_id
 ), horse_charges as (
  select horse_id,coalesce(sum(cents) filter(where status='issued'),0) as issued_cents,
   coalesce(sum(cents) filter(where status='draft'),0) as draft_cents,coalesce(sum(cents) filter(where status='issued' and basis='package'),0) as package_cents,coalesce(sum(cents) filter(where basis='adjustment'),0) as adjustment_cents from period_charges group by horse_id
 ), agreements as (
  select s.horse_id,jsonb_agg(jsonb_build_object('stay_id',s.id,'customer_id',s.billing_customer_id,'customer_name',c.name,'from',s.arrival_date,'to',s.departure_date,'mode',s.feed_billing,'monthly_cents',s.feed_monthly_cents) order by s.arrival_date,s.id) as entries,
   bool_or(s.feed_billing='included' and (
    not exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id join public.effective_package_reporting p on p.line_id=l.id and (p.feed_cents>0 or p.feed_included is not null)
     where i.stay_id=s.id and i.status in ('draft','issued') and i.period_from<=p_to and i.period_to>=p_from)
    or exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id
     where i.stay_id=s.id and i.status in ('draft','issued') and l.kind='training' and i.period_from<=p_to and i.period_to>=p_from
     and not exists(select 1 from public.effective_package_reporting p where p.line_id=l.id and (p.feed_cents>0 or p.feed_included is not null)))
   )) as included
  from public.training_stays s join public.customers c on c.id=s.billing_customer_id
  where s.arrival_date<=p_to and (s.departure_date is null or s.departure_date>=p_from) group by s.horse_id
 ), invoice_parts as (
  select horse_id,invoice_id,status,invoice_number,customer_id,coalesce(customer_snapshot->>'name',max(c.name)) as customer_name,
   period_from,period_to,issue_date,sum(cents) as cents,bool_or(basis='actual_cost') as actual_cost,bool_or(basis='manual_period') as manual_period,
   exists(select 1 from public.invoice_adjustments a left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
    where a.invoice_id=pc.invoice_id and (r.id is null or (r.feed_cents>0 and exists(select 1 from unsupported_invoices u where u.invoice_id=a.invoice_id)))) as has_adjustments,
   sum(cents) filter(where basis='package') as package_cents,coalesce(sum(cents) filter(where basis='adjustment'),0) as adjustment_cents
  from period_charges pc join public.customers c on c.id=pc.customer_id
  group by horse_id,invoice_id,status,invoice_number,customer_id,customer_snapshot,period_from,period_to,issue_date
 ), invoice_groups as (
  select horse_id,jsonb_agg(to_jsonb(ip)-'horse_id' order by issue_date,invoice_id) as entries,
   bool_or(has_adjustments and status='issued') as has_adjustments from invoice_parts ip group by horse_id
 ), unmatched as (
  select coalesce(st.horse_id,rl.horse_id) as horse_id,l.id as line_id,i.id as invoice_id,i.invoice_number,i.status,l.description,l.amount_cents,i.issue_date,
   case when l.kind='manual' then 'Review manual feed dates, amount and invoice horse assignment' else 'Feed line has no supported source allocation' end as reason
  from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  left join public.training_stays st on st.id=i.stay_id
  left join public.invoice_reporting_links rl on rl.invoice_id=i.id and rl.retired_at is null and i.stay_id is null
  where l.billing_category='feed' and i.status in ('draft','issued')
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from) or exists(select 1 from public.manual_feed_periods a where a.line_id=l.id and a.retired_at is null and a.covered_from<=p_to and a.covered_to>=p_from))
   and not exists(select 1 from public.invoice_service_days d where d.line_id=l.id and d.service='feed')
   and not exists(select 1 from public.invoice_feed_claims c where c.line_id=l.id)
   and not exists(select 1 from public.valid_manual_feed_periods m where m.line_id=l.id)
 ), horse_ids as (
  select horse_id from horse_cost union select horse_id from horse_charges union select horse_id from agreements union select horse_id from unmatched
 ), rows as (
  select h.id as horse_id,h.barn_name as name,coalesce(c.cost_cents,0) as cost_cents,coalesce(c.feeding_lines,0) as feeding_lines,
   coalesce(c.feeding_days,0) as feeding_days,coalesce(c.unbilled_actual_cents,0) as unbilled_actual_cents,
   coalesce(ch.issued_cents,0) as issued_cents,coalesce(ch.draft_cents,0) as draft_cents,coalesce(ch.package_cents,0) as package_cents,coalesce(ch.adjustment_cents,0) as adjustment_cents,
   coalesce(ch.issued_cents,0)-coalesce(c.cost_cents,0) as difference_cents,
   case when coalesce(ch.issued_cents,0)>0 then round((ch.issued_cents-coalesce(c.cost_cents,0))*100/ch.issued_cents,2) end as margin_percent,
   coalesce(a.included,false) as included,(coalesce(ig.has_adjustments,false) or exists(
    select 1 from public.invoices i left join public.training_stays st on st.id=i.stay_id
    left join public.invoice_reporting_links rl on rl.invoice_id=i.id and rl.retired_at is null and i.stay_id is null
    join public.invoice_adjustments adj on adj.invoice_id=i.id
    left join public.adjustment_reporting_allocations ar on ar.adjustment_id=adj.id and ar.retired_at is null
    where i.status='issued' and coalesce(st.horse_id,rl.horse_id)=h.id
     and coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from
     and (ar.id is null or (ar.feed_cents>0 and not exists(select 1 from allocated ac where ac.invoice_id=i.id)))
   )) as has_adjustments,
   exists(select 1 from unmatched u where u.horse_id=h.id and u.status='issued') as has_unmatched,
   coalesce(a.entries,'[]'::jsonb) as agreements,coalesce(ig.entries,'[]'::jsonb) as invoices
  from horse_ids ids join public.horses h on h.id=ids.horse_id
  left join horse_cost c on c.horse_id=h.id left join horse_charges ch on ch.horse_id=h.id
  left join agreements a on a.horse_id=h.id left join invoice_groups ig on ig.horse_id=h.id
 ) select jsonb_build_object('horses',coalesce((select jsonb_agg(to_jsonb(r) order by name,horse_id) from rows r),'[]'::jsonb),
  'totals',(select jsonb_build_object('cost_cents',coalesce(sum(cost_cents),0),'issued_cents',coalesce(sum(issued_cents),0),'draft_cents',coalesce(sum(draft_cents),0),'package_cents',coalesce(sum(package_cents),0),'adjustment_cents',coalesce(sum(adjustment_cents),0),'unbilled_actual_cents',coalesce(sum(unbilled_actual_cents),0)) from rows),
  'unmatched_count',(select count(*) from unmatched),'unmatched_issued_cents',(select coalesce(sum(amount_cents) filter(where status='issued'),0) from unmatched),
  'unmatched',coalesce((select jsonb_agg(to_jsonb(u)) from (select * from unmatched order by issue_date,invoice_id,line_id limit 25) u),'[]'::jsonb),
  'unassigned_cost_cents',(select coalesce(round(sum(cost_cents)),0) from feeding where horse_id is null)) into result;
 return result;
end; $$;
revoke all on function public.feed_charge_comparison(date,date) from public,anon;
grant execute on function public.feed_charge_comparison(date,date) to authenticated;
commit;
