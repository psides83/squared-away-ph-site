begin;
create table public.manual_feed_periods (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),line_id uuid not null,
 horse_id uuid not null references public.horses(id),stay_id uuid references public.training_stays(id),
 amount_cents integer not null check(amount_cents between 0 and 100000000),
 covered_from date not null,covered_to date not null check(covered_to>=covered_from and covered_to-covered_from<=3660),
 reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index current_manual_feed_period on public.manual_feed_periods(line_id) where retired_at is null;
alter table public.manual_feed_periods enable row level security;
revoke all on public.manual_feed_periods from public,anon,authenticated;
grant select on public.manual_feed_periods to authenticated;
create policy admin_read on public.manual_feed_periods for select to authenticated using((select public.is_admin()));
-- No line FK: deleting a draft line retains its private review history without affecting the normal delete workflow.
create view public.manual_feed_sources with(security_invoker=true) as
select l.id as line_id,i.id as invoice_id,l.amount_cents,l.description,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,
 coalesce(s.horse_id,r.horse_id) as horse_id,coalesce(i.stay_id,r.stay_id) as stay_id,
 ts.arrival_date,ts.departure_date
from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
left join public.training_stays s on s.id=i.stay_id
left join public.invoice_reporting_links r on r.invoice_id=i.id and r.retired_at is null and i.stay_id is null
left join public.training_stays ts on ts.id=coalesce(i.stay_id,r.stay_id)
where l.kind='manual' and l.billing_category='feed' and l.amount_cents>=0 and i.status in ('draft','issued');
revoke all on public.manual_feed_sources from public,anon,authenticated;
grant select on public.manual_feed_sources to authenticated;
create view public.valid_manual_feed_periods with(security_invoker=true) as
select s.*,a.covered_from,a.covered_to,a.id as allocation_id
from public.manual_feed_sources s join public.manual_feed_periods a on a.line_id=s.line_id and a.retired_at is null and not a.cleared
where a.invoice_id=s.invoice_id and a.amount_cents=s.amount_cents and a.horse_id=s.horse_id and a.stay_id is not distinct from s.stay_id
 and (s.stay_id is null or a.covered_from>=s.arrival_date and (s.departure_date is null or a.covered_to<=s.departure_date));
revoke all on public.valid_manual_feed_periods from public,anon,authenticated;
grant select on public.valid_manual_feed_periods to authenticated;
create function public.set_manual_feed_period(p_request uuid,p_line uuid,p_current uuid,p_horse uuid,p_stay uuid,p_amount integer,p_from date,p_to date,p_reason text,p_clear boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.manual_feed_periods%rowtype; current_row public.manual_feed_periods%rowtype; source public.manual_feed_sources%rowtype; invoice uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into old from public.manual_feed_periods where id=p_request;
 if found then invoice:=old.invoice_id; else select invoice_id into invoice from public.invoice_lines where id=p_line; end if;
 perform 1 from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found'; end if;
 -- Compare the retained request before checking current source state. Late retries never reapply old versions.
 if old.id is not null then
  if row(old.line_id,old.horse_id,old.stay_id,old.amount_cents,old.covered_from,old.covered_to,old.reason,old.cleared) is distinct from row(p_line,p_horse,p_stay,p_amount,p_from,p_to,trim(p_reason),p_clear) then raise exception 'This request was already used with different values'; end if;
  return old.id;
 end if;
 select * into current_row from public.manual_feed_periods where line_id=p_line and retired_at is null;
 if current_row.id is distinct from p_current then raise exception 'The feed period changed. Close and reopen this editor'; end if;
 if p_request is null or p_clear is null or p_horse is null or p_amount is null or p_amount<0 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a horse assignment, nonnegative amount, covered dates of at most ten years and a reason'; end if;
 if p_clear then
  if current_row.id is null or current_row.cleared or row(current_row.horse_id,current_row.stay_id,current_row.amount_cents,current_row.covered_from,current_row.covered_to) is distinct from row(p_horse,p_stay,p_amount,p_from,p_to) then raise exception 'Choose the current saved period to clear'; end if;
 else
  select * into source from public.manual_feed_sources where line_id=p_line;
  if not found then raise exception 'Choose a nonnegative manual feed line on a draft or finalized invoice'; end if;
  if row(source.horse_id,source.stay_id,source.amount_cents) is distinct from row(p_horse,p_stay,p_amount) then raise exception 'The invoice horse assignment or charge changed. Reload before reviewing dates'; end if;
  if p_stay is not null then
   perform 1 from public.training_stays where id=p_stay for share;
   -- Re-read after locking the stay against concurrent term changes.
   select * into source from public.manual_feed_sources where line_id=p_line;
   if source.horse_id is distinct from p_horse or p_from<source.arrival_date or source.departure_date is not null and p_to>source.departure_date then raise exception 'Covered dates must fit the assigned horse’s stay'; end if;
  end if;
 end if;
 update public.manual_feed_periods set retired_at=now() where id=current_row.id;
 insert into public.manual_feed_periods(id,invoice_id,line_id,horse_id,stay_id,amount_cents,covered_from,covered_to,reason,cleared,created_by)
 values(p_request,invoice,p_line,p_horse,p_stay,p_amount,p_from,p_to,trim(p_reason),p_clear,auth.uid());
 return p_request;
end; $$;
revoke all on function public.set_manual_feed_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean) from public,anon;
grant execute on function public.set_manual_feed_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean) to authenticated;
create function public.manual_feed_reporting(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page'; end if;
 with rows as (
  select l.id,l.description,l.amount_cents,i.status,i.issue_date,i.period_from,i.period_to,
   coalesce(s.horse_id,r.horse_id) as horse_id,coalesce(i.stay_id,r.stay_id) as stay_id,h.barn_name as horse_name,
   a.id is not null and not a.cleared as has_saved_period,
   exists(select 1 from public.valid_manual_feed_periods v where v.line_id=l.id) as valid,
   case when a.id is null then null else to_jsonb(a)-'created_by' end as current,
   coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.manual_feed_periods x where x.line_id=l.id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
  from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  left join public.training_stays s on s.id=i.stay_id
  left join public.invoice_reporting_links r on r.invoice_id=i.id and r.retired_at is null and i.stay_id is null
  left join public.horses h on h.id=coalesce(s.horse_id,r.horse_id)
  left join public.manual_feed_periods a on a.line_id=l.id and a.retired_at is null
  where i.id=p_invoice and l.kind='manual' and l.billing_category='feed'
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rows order by id offset (p_page-1)*25 limit 25)x),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.manual_feed_reporting(uuid,integer) from public,anon;
grant execute on function public.manual_feed_reporting(uuid,integer) to authenticated;
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
  from public.package_line_reporting p join public.invoice_lines l on l.id=p.line_id
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
    not exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id join public.package_line_reporting p on p.line_id=l.id and (p.feed_cents>0 or p.feed_included is true)
     where i.stay_id=s.id and i.status in ('draft','issued') and i.period_from<=p_to and i.period_to>=p_from)
    or exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id
     where i.stay_id=s.id and i.status in ('draft','issued') and l.kind='training' and i.period_from<=p_to and i.period_to>=p_from
     and not exists(select 1 from public.package_line_reporting p where p.line_id=l.id and (p.feed_cents>0 or p.feed_included is true)))
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
