begin;
create function public.feed_charge_comparison(p_from date,p_to date) returns jsonb
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
   and exists(select 1 from public.invoice_service_days x where x.line_id=l.id and x.day between p_from and p_to)
  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,m.movement_date,
   greatest(-m.value_delta_cents,0),m.id::text,'actual_cost'
  from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id
  join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id
  join public.training_stays s on s.id=c.stay_id
  where l.billing_category='feed' and i.status in ('draft','issued')
   and exists(select 1 from public.invoice_feed_claims x join public.inventory_movements xm on xm.id=x.movement_id where x.line_id=l.id and xm.movement_date between p_from and p_to)
 ), weighted as (
  select *,case when sum(weight) over(partition by line_id)=0 then 1::numeric/count(*) over(partition by line_id)
   else weight/sum(weight) over(partition by line_id) end as fraction from charge_sources
 ), shares as (
  select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from weighted
 ), allocated as (
  -- Largest remainder reconciles every saved line to exact cents, with stable ties.
  select *,whole+case when row_number() over(partition by line_id order by remainder desc,service_date,tie_key)
    <=amount_cents-sum(whole) over(partition by line_id) then 1 else 0 end as cents from shares
 ), period_charges as (select * from allocated where service_date between p_from and p_to),
 horse_cost as (
  select horse_id,round(sum(cost_cents)) as cost_cents,count(*) as feeding_lines,count(distinct movement_date) as feeding_days,
   round(coalesce(sum(cost_cents) filter(where exists(select 1 from public.training_stays s where s.horse_id=feeding.horse_id and s.feed_billing='at_cost' and feeding.movement_date>=s.arrival_date and (s.departure_date is null or feeding.movement_date<=s.departure_date))
    and not exists(select 1 from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id where c.movement_id=feeding.id and i.status in ('draft','issued'))),0)) as unbilled_actual_cents
  from feeding group by horse_id
 ), horse_charges as (
  select horse_id,coalesce(sum(cents) filter(where status='issued'),0) as issued_cents,
   coalesce(sum(cents) filter(where status='draft'),0) as draft_cents from period_charges group by horse_id
 ), agreements as (
  select s.horse_id,jsonb_agg(jsonb_build_object('stay_id',s.id,'customer_id',s.billing_customer_id,'customer_name',c.name,'from',s.arrival_date,'to',s.departure_date,'mode',s.feed_billing,'monthly_cents',s.feed_monthly_cents) order by s.arrival_date,s.id) as entries,
   bool_or(s.feed_billing='included') as included
  from public.training_stays s join public.customers c on c.id=s.billing_customer_id
  where s.arrival_date<=p_to and (s.departure_date is null or s.departure_date>=p_from) group by s.horse_id
 ), invoice_parts as (
  select horse_id,invoice_id,status,invoice_number,customer_id,coalesce(customer_snapshot->>'name',max(c.name)) as customer_name,
   period_from,period_to,issue_date,sum(cents) as cents,bool_or(basis='actual_cost') as actual_cost,
   exists(select 1 from public.invoice_adjustments a where a.invoice_id=pc.invoice_id) as has_adjustments
  from period_charges pc join public.customers c on c.id=pc.customer_id
  group by horse_id,invoice_id,status,invoice_number,customer_id,customer_snapshot,period_from,period_to,issue_date
 ), invoice_groups as (
  select horse_id,jsonb_agg(to_jsonb(ip)-'horse_id' order by issue_date,invoice_id) as entries,
   bool_or(has_adjustments and status='issued') as has_adjustments from invoice_parts ip group by horse_id
 ), unmatched as (
  select coalesce(st.horse_id,rl.horse_id) as horse_id,l.id as line_id,i.id as invoice_id,i.invoice_number,i.status,l.description,l.amount_cents,i.issue_date,
   case when l.kind='manual' then 'Manual feed line has no service-source dates' else 'Feed line has no supported source allocation' end as reason
  from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  left join public.training_stays st on st.id=i.stay_id
  left join public.invoice_reporting_links rl on rl.invoice_id=i.id and rl.retired_at is null and i.stay_id is null
  where l.billing_category='feed' and i.status in ('draft','issued')
   and coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from
   and not exists(select 1 from public.invoice_service_days d where d.line_id=l.id and d.service='feed')
   and not exists(select 1 from public.invoice_feed_claims c where c.line_id=l.id)
 ), horse_ids as (
  select horse_id from horse_cost union select horse_id from horse_charges union select horse_id from agreements union select horse_id from unmatched
 ), rows as (
  select h.id as horse_id,h.barn_name as name,coalesce(c.cost_cents,0) as cost_cents,coalesce(c.feeding_lines,0) as feeding_lines,
   coalesce(c.feeding_days,0) as feeding_days,coalesce(c.unbilled_actual_cents,0) as unbilled_actual_cents,
   coalesce(ch.issued_cents,0) as issued_cents,coalesce(ch.draft_cents,0) as draft_cents,
   coalesce(ch.issued_cents,0)-coalesce(c.cost_cents,0) as difference_cents,
   case when coalesce(ch.issued_cents,0)>0 then round((ch.issued_cents-coalesce(c.cost_cents,0))*100/ch.issued_cents,2) end as margin_percent,
   coalesce(a.included,false) as included,coalesce(ig.has_adjustments,false) as has_adjustments,
   exists(select 1 from unmatched u where u.horse_id=h.id and u.status='issued') as has_unmatched,
   coalesce(a.entries,'[]'::jsonb) as agreements,coalesce(ig.entries,'[]'::jsonb) as invoices
  from horse_ids ids join public.horses h on h.id=ids.horse_id
  left join horse_cost c on c.horse_id=h.id left join horse_charges ch on ch.horse_id=h.id
  left join agreements a on a.horse_id=h.id left join invoice_groups ig on ig.horse_id=h.id
 ) select jsonb_build_object('horses',coalesce((select jsonb_agg(to_jsonb(r) order by name,horse_id) from rows r),'[]'::jsonb),
  'totals',(select jsonb_build_object('cost_cents',coalesce(sum(cost_cents),0),'issued_cents',coalesce(sum(issued_cents),0),'draft_cents',coalesce(sum(draft_cents),0),'unbilled_actual_cents',coalesce(sum(unbilled_actual_cents),0)) from rows),
  'unmatched_count',(select count(*) from unmatched),'unmatched_issued_cents',(select coalesce(sum(amount_cents) filter(where status='issued'),0) from unmatched),
  'unmatched',coalesce((select jsonb_agg(to_jsonb(u)) from (select * from unmatched order by issue_date,invoice_id,line_id limit 25) u),'[]'::jsonb),
  'unassigned_cost_cents',(select coalesce(round(sum(cost_cents)),0) from feeding where horse_id is null)) into result;
 return result;
end; $$;
revoke all on function public.feed_charge_comparison(date,date) from public,anon;
grant execute on function public.feed_charge_comparison(date,date) to authenticated;
commit;
