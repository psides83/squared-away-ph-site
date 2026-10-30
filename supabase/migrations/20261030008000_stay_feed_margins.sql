begin;
create view public.dated_feed_revenue with(security_invoker=true) as
with charge_sources as (
  select l.id as line_id,i.id as invoice_id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,
   i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,d.day as service_date,
   1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') as weight,
   d.day::text as tie_key,'monthly'::text as basis,s.id as stay_id
  from public.invoice_service_days d join public.invoice_lines l on l.id=d.line_id
  join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=d.stay_id
  where d.service='feed' and l.billing_category='feed' and i.status in ('draft','issued')

  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,m.movement_date,
   greatest(-m.value_delta_cents,0),m.id::text,'actual_cost',s.id
  from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id
  join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id
  join public.training_stays s on s.id=c.stay_id
  where l.billing_category='feed' and i.status in ('draft','issued')

  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,p.feed_cents,s.horse_id,d.day,
   1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day'),d.day::text,'package',s.id
  from public.effective_package_reporting p join public.invoice_lines l on l.id=p.line_id
  join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=i.stay_id
  join public.invoice_day_claims d on d.line_id=l.id
  where i.status in ('draft','issued') and (p.feed_cents>0 or p.feed_included is true)
  union all
  select m.line_id,m.invoice_id,m.status,m.invoice_number,m.customer_id,m.customer_snapshot,m.period_from,m.period_to,m.issue_date,m.amount_cents,m.horse_id,day::date,
   1::numeric,day::date::text,'manual_period',m.stay_id
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
 ) select * from allocated;
revoke all on public.dated_feed_revenue from public,anon,authenticated;
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
 ), allocated as (select line_id,invoice_id,status,invoice_number,customer_id,customer_snapshot,period_from,period_to,issue_date,amount_cents,horse_id,service_date,weight,tie_key,basis,fraction,whole,remainder,cents from public.dated_feed_revenue ), unsupported_invoices as (
  select distinct l.invoice_id from public.invoice_lines l
  where l.billing_category='feed' and not exists(select 1 from allocated c where c.line_id=l.id)
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
-- Adjustment cents retain the same invoice-wide dated allocation as the horse comparison.
create view public.dated_feed_adjustments with(security_invoker=true) as
with days as (
 select a.id as adjustment_id,c.invoice_id,c.horse_id,c.stay_id,c.service_date,r.feed_cents::bigint as amount_cents,
 sign(a.amount_cents::numeric) as direction,sum(c.cents) as weight
 from public.invoice_adjustments a join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
 join public.dated_feed_revenue c on c.invoice_id=a.invoice_id and c.status='issued'
 where r.feed_cents>0 and not exists(select 1 from public.invoice_lines l where l.invoice_id=a.invoice_id and l.billing_category='feed'
  and not exists(select 1 from public.dated_feed_revenue d where d.line_id=l.id))
 group by a.id,c.invoice_id,c.horse_id,c.stay_id,c.service_date,r.feed_cents
), fractions as (
 select *,case when sum(weight) over(partition by adjustment_id)=0 then 1::numeric/count(*) over(partition by adjustment_id)
 else weight/sum(weight) over(partition by adjustment_id) end as fraction from days
), shares as (
 select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from fractions
)
select *,direction*(whole+case when row_number() over(partition by adjustment_id order by remainder desc,service_date,horse_id)
 <=amount_cents-sum(whole) over(partition by adjustment_id) then 1 else 0 end) as cents from shares;
revoke all on public.dated_feed_adjustments from public,anon,authenticated;

create function public.stay_feed_margins(p_from date,p_to date,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose valid dates and a report page';end if;
 with feeding as materialized (
  select m.id,m.horse_id,s.id as stay_id,m.movement_date,-m.value_delta_cents as cost_cents
  from public.inventory_movements m left join public.training_stays s on s.horse_id=m.horse_id and m.movement_date>=s.arrival_date and (s.departure_date is null or m.movement_date<=s.departure_date)
  where m.kind='feeding' and m.movement_date between p_from and p_to and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)
 ), raw_costs as (
  select horse_id,stay_id,sum(cost_cents) as raw_cents,count(*) as feeding_lines,count(distinct movement_date) as feeding_days from feeding group by horse_id,stay_id
 ), costs as (
  -- Preserve each horse comparison's rounded total; distribute fractional-cent ties stably.
  select *,floor(raw_cents)+case when row_number() over(partition by horse_id order by raw_cents-floor(raw_cents) desc,stay_id nulls last)
   <=round(sum(raw_cents) over(partition by horse_id))-sum(floor(raw_cents)) over(partition by horse_id) then 1 else 0 end as cost_cents from raw_costs
 ), revenue as (
  select horse_id,stay_id,invoice_id,status,basis,cents from public.dated_feed_revenue where service_date between p_from and p_to
  union all select horse_id,stay_id,invoice_id,'issued','adjustment',cents from public.dated_feed_adjustments where service_date between p_from and p_to
 ), charges as (
  select horse_id,stay_id,coalesce(sum(cents) filter(where status='issued'),0) as issued_cents,
   coalesce(sum(cents) filter(where status='draft'),0) as draft_cents,
   coalesce(sum(cents) filter(where status='issued' and basis='package'),0) as package_cents,
   coalesce(sum(cents) filter(where basis='adjustment'),0) as adjustment_cents
  from revenue group by horse_id,stay_id
 ), invoice_context as (
  select i.*,coalesce(s.horse_id,r.horse_id) as horse_id,coalesce(i.stay_id,r.stay_id) as report_stay
  from public.invoices i left join public.training_stays s on s.id=i.stay_id
  left join public.invoice_reporting_links r on r.invoice_id=i.id and r.retired_at is null and i.stay_id is null
  where i.status='issued'
 ), review as (
  select i.id as invoice_id,i.invoice_number,i.horse_id,i.report_stay as stay_id,'Feed source dates or package split need review'::text as reason
  from invoice_context i join public.invoice_lines l on l.invoice_id=i.id
  left join public.training_stays s on s.id=i.stay_id
  where (l.billing_category='feed' and not exists(select 1 from public.dated_feed_revenue d where d.line_id=l.id)
   or l.kind='training' and s.feed_billing='included' and not exists(select 1 from public.effective_package_reporting p where p.line_id=l.id and (p.feed_cents>0 or p.feed_included is not null)))
  and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
   or exists(select 1 from public.manual_feed_periods m where m.line_id=l.id and m.retired_at is null and m.covered_from<=p_to and m.covered_to>=p_from))
  union
  select i.id,i.invoice_number,i.horse_id,i.report_stay,'Invoice adjustment needs a supported feed allocation'
  from invoice_context i join public.invoice_adjustments a on a.invoice_id=i.id
  left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  where (r.id is null or r.feed_cents>0 and not exists(select 1 from public.dated_feed_adjustments d where d.adjustment_id=a.id))
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
    or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
  union
  select i.id,i.invoice_number,i.horse_id,i.report_stay,'Feed cost correction needs invoice review'
  from invoice_context i where exists(select 1 from public.invoice_feed_cost_flags f where f.invoice_id=i.id and f.resolved_at is null)
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
    or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 ), ids as (
  select stay_id from costs where stay_id is not null union select stay_id from charges where stay_id is not null
  union select stay_id from review where stay_id is not null
  union select id from public.training_stays where arrival_date<=p_to and (departure_date is null or departure_date>=p_from)
 ), rows as (
  select s.id as stay_id,s.horse_id,h.barn_name as name,c.name as customer_name,s.arrival_date,s.departure_date,
   coalesce(fc.cost_cents,0) as cost_cents,coalesce(fc.feeding_lines,0) as feeding_lines,coalesce(fc.feeding_days,0) as feeding_days,
   coalesce(ch.issued_cents,0) as issued_cents,coalesce(ch.draft_cents,0) as draft_cents,coalesce(ch.package_cents,0) as package_cents,coalesce(ch.adjustment_cents,0) as adjustment_cents,
   (select count(*) from review r where r.stay_id=s.id) as review_count,
   s.feed_billing='included' and not exists(select 1 from public.effective_package_reporting p join public.invoice_lines l on l.id=p.line_id
    join public.invoices i on i.id=l.invoice_id join public.invoice_day_claims d on d.line_id=l.id
    where i.stay_id=s.id and i.status in ('draft','issued') and (p.feed_cents>0 or p.feed_included is not null) and d.day between p_from and p_to) as package_review
  from ids join public.training_stays s on s.id=ids.stay_id join public.horses h on h.id=s.horse_id join public.customers c on c.id=s.billing_customer_id
  left join costs fc on fc.stay_id=s.id left join charges ch on ch.stay_id=s.id
 ), totals as (
  select coalesce(sum(cost_cents),0) as cost_cents,coalesce(sum(issued_cents),0) as issued_cents,coalesce(sum(draft_cents),0) as draft_cents,
   coalesce(sum(package_cents),0) as package_cents,coalesce(sum(adjustment_cents),0) as adjustment_cents from rows
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by name,arrival_date desc,stay_id) from(select * from rows order by name,arrival_date desc,stay_id limit 25 offset (p_page-1)*25)x),'[]'::jsonb),
  'count',(select count(*) from rows),'totals',(select to_jsonb(t) from totals t),
  'unassigned_cost_cents',(select coalesce(sum(cost_cents),0) from costs where stay_id is null),
  'unassigned_revenue_cents',(select coalesce(sum(issued_cents),0) from charges where stay_id is null),
  'unassigned_draft_cents',(select coalesce(sum(draft_cents),0) from charges where stay_id is null),
  'review_count',(select count(*) from review),'review',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from review order by invoice_id,reason limit 25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.stay_feed_margins(date,date,integer) from public,anon;
grant execute on function public.stay_feed_margins(date,date,integer) to authenticated;
commit;
