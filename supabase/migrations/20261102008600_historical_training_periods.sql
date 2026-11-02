begin;
alter table public.manual_service_periods add column source_kind text not null default 'manual' check(source_kind in ('manual','training'));
create or replace view public.manual_service_sources with(security_invoker=true) as
select l.id as line_id,i.id as invoice_id,l.description,l.amount_cents,case when l.billing_category='boarding' then 'board' else 'training' end as service,
 i.status,i.issue_date,i.period_from,i.period_to,c.horse_id,c.stay_id,s.arrival_date,s.departure_date,
 md5(jsonb_build_array(l.id,i.id,l.amount_cents,l.billing_category,l.kind,c.horse_id,c.stay_id,s.arrival_date,s.departure_date,
 case when l.billing_category='training' then (select jsonb_agg(jsonb_build_object('day',d.day,'status',d.status) order by d.day) from public.training_days d where d.stay_id=c.stay_id) end)::text) as source_token
from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
left join public.training_stays s on s.id=c.stay_id
where ((l.kind='manual' and l.billing_category in ('training','boarding')) or (l.kind='training' and l.amount_cents>=0 and not exists(select 1 from public.invoice_day_claims d where d.line_id=l.id))) and i.status in ('draft','issued');
revoke all on public.manual_service_sources from public,anon,authenticated;
create or replace view public.valid_manual_service_periods with(security_invoker=true) as
select s.*,a.id as allocation_id,a.covered_from,a.covered_to,a.days,a.feed_cents,a.board_cents,a.package_reviewed,a.source_kind
from public.manual_service_sources s join public.manual_service_periods a on a.line_id=s.line_id and a.retired_at is null and not a.cleared
where a.source_kind=(select kind from public.invoice_lines where id=s.line_id) and a.invoice_id=s.invoice_id and a.amount_cents=s.amount_cents and a.horse_id=s.horse_id and a.stay_id is not distinct from s.stay_id and a.service=s.service
 and (s.stay_id is null or a.covered_from>=s.arrival_date and (s.departure_date is null or a.covered_to<=s.departure_date))
 and (a.service='board' or a.stay_id is not null and a.days=(select jsonb_agg(jsonb_build_object('day',d.day,'status',d.status) order by d.day) from public.training_days d where d.stay_id=a.stay_id and d.day between a.covered_from and a.covered_to));
revoke all on public.valid_manual_service_periods from public,anon,authenticated;
create or replace function public.set_manual_package_period(p_request uuid,p_line uuid,p_current uuid,p_horse uuid,p_stay uuid,p_amount integer,p_from date,p_to date,p_reason text,p_clear boolean default false,p_token text default null,p_feed integer default 0,p_board integer default 0,p_package boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.manual_service_periods%rowtype;cur public.manual_service_periods%rowtype;source public.manual_service_sources%rowtype;invoice uuid;days jsonb;kind text;line_kind text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into old from public.manual_service_periods where id=p_request;
 if found then invoice:=old.invoice_id;else select invoice_id into invoice from public.invoice_lines where id=p_line;end if;
 perform 1 from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found';end if;
 select * into old from public.manual_service_periods where id=p_request;
 if old.id is not null then
  if row(old.line_id,old.horse_id,old.stay_id,old.amount_cents,old.covered_from,old.covered_to,old.reason,old.cleared,old.source_token,old.feed_cents,old.board_cents,old.package_reviewed) is distinct from row(p_line,p_horse,p_stay,p_amount,p_from,p_to,trim(p_reason),p_clear,p_token,p_feed,p_board,p_package) then raise exception 'This request was already used with different values';end if;
  return old.id;
 end if;
 select * into cur from public.manual_service_periods where line_id=p_line and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The service period changed. Close and reopen this editor';end if;
 if p_request is null or p_clear is null or p_horse is null or p_amount is null or p_amount not between -100000000 and 100000000 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_token is null or length(p_token)<>32 then raise exception 'Enter current source details, valid covered dates and a private reason';end if;
 if p_feed is null or p_board is null or p_package is null or least(p_feed,p_board)<0 or greatest(p_feed,p_board)>100000000 or (not p_package and (p_feed<>0 or p_board<>0)) or (p_package and (p_amount<0 or p_feed::bigint+p_board>p_amount)) then raise exception 'Enter feed and board portions within the saved nonnegative package amount';end if;
 if p_clear then
  if cur.id is null or cur.cleared or row(cur.horse_id,cur.stay_id,cur.amount_cents,cur.covered_from,cur.covered_to,cur.source_token,cur.feed_cents,cur.board_cents,cur.package_reviewed) is distinct from row(p_horse,p_stay,p_amount,p_from,p_to,p_token,p_feed,p_board,p_package) then raise exception 'Choose the current saved service period to clear';end if;
  kind:=cur.service;days:=cur.days;line_kind:=cur.source_kind;
 else
  if p_stay is not null then perform 1 from public.training_stays where id=p_stay for update;end if;
  select * into source from public.manual_service_sources where line_id=p_line;
  if not found then raise exception 'Choose a manual training or board line on a draft or finalized invoice';end if;
  if row(source.horse_id,source.stay_id,source.amount_cents,source.source_token) is distinct from row(p_horse,p_stay,p_amount,p_token) then raise exception 'The invoice assignment, charge or training-day records changed. Close and reopen this editor';end if;
  if p_stay is not null and (p_from<source.arrival_date or source.departure_date is not null and p_to>source.departure_date) then raise exception 'Covered dates must fit the assigned stay';end if;
  kind:=source.service;
  select l.kind into line_kind from public.invoice_lines l where l.id=p_line;
  if line_kind='training' and not p_package then raise exception 'Review explicit feed and board portions, including zero, for this historical generated charge';end if;
  if p_package and kind<>'training' then raise exception 'Only a manual training line can be reviewed as a package';end if;
  if kind='training' then
   if p_stay is null then raise exception 'Assign this invoice to a training stay before reviewing training days';end if;
   if p_to>(now() at time zone 'America/Chicago')::date then raise exception 'Review elapsed training days only';end if;
   select jsonb_agg(jsonb_build_object('day',d.day,'status',d.status) order by d.day) into days from public.training_days d where d.stay_id=p_stay and d.day between p_from and p_to;
   if coalesce(jsonb_array_length(days),0)<>p_to-p_from+1 then raise exception 'Classify every covered stay day before reviewing training revenue';end if;
   if not exists(select 1 from jsonb_array_elements(days) d where d->>'status' in ('worked','rest')) then raise exception 'No worked or billable-rest days in this period';end if;
  end if;
 end if;
 update public.manual_service_periods set retired_at=now() where id=cur.id;
 insert into public.manual_service_periods(id,invoice_id,line_id,horse_id,stay_id,service,amount_cents,covered_from,covered_to,source_token,days,reason,cleared,created_by,feed_cents,board_cents,package_reviewed,source_kind)
 values(p_request,invoice,p_line,p_horse,p_stay,kind,p_amount,p_from,p_to,p_token,days,trim(p_reason),p_clear,auth.uid(),p_feed,p_board,p_package,line_kind);
 return p_request;
end;$$;
create or replace function public.manual_service_reporting(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with rows as (
 select l.id,l.description,l.amount_cents,l.kind as source_kind,exists(select 1 from public.invoice_day_claims d where d.line_id=l.id) as has_billing_days,case when l.billing_category='boarding' then 'board' else 'training' end as service,i.status,i.issue_date,i.period_from,i.period_to,c.horse_id,c.stay_id,h.barn_name as horse_name,s.source_token,
 a.id is not null and not a.cleared as has_saved_period,exists(select 1 from public.valid_manual_service_periods v where v.line_id=l.id) as valid,
 case when a.id is null then null else to_jsonb(a)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.manual_service_periods x where x.line_id=l.id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
 left join public.horses h on h.id=c.horse_id left join public.manual_service_sources s on s.line_id=l.id
 left join public.manual_service_periods a on a.line_id=l.id and a.retired_at is null
 where i.id=p_invoice and ((l.kind='manual' and l.billing_category in ('training','boarding')) or (l.kind='training' and l.amount_cents>=0 and (not exists(select 1 from public.invoice_day_claims d where d.line_id=l.id) or exists(select 1 from public.manual_service_periods old where old.line_id=l.id and old.invoice_id=i.id and old.source_kind='training' and old.retired_at is null and not old.cleared))))
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rows order by id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.manual_service_reporting(uuid,integer) from public,anon;
grant execute on function public.manual_service_reporting(uuid,integer) to authenticated;
create view public.dated_package_reporting with(security_invoker=true) as
select p.* from public.effective_package_reporting p where not exists(select 1 from public.valid_manual_service_periods m where m.line_id=p.line_id and m.source_kind='training' and m.package_reviewed)
union all select m.line_id,null::uuid,m.feed_cents,m.board_cents,m.amount_cents-m.feed_cents-m.board_cents,true,true,m.allocation_id
from public.valid_manual_service_periods m where m.source_kind='training' and m.package_reviewed;
revoke all on public.dated_package_reporting from public,anon,authenticated;
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
 union all
 select m.line_id,m.invoice_id,m.service,case when m.service='training' then m.amount_cents-m.feed_cents-m.board_cents else m.amount_cents end,d.day,case when m.source_kind='training' then 1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') else 1::numeric end
 from public.valid_manual_service_periods m cross join lateral (
  select day::date as day from generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day where m.service='board'
  union all select (x->>'day')::date from jsonb_array_elements(m.days) x where m.service='training' and x->>'status' in ('worked','rest')
 ) d
 union all
 select m.line_id,m.invoice_id,'board',m.board_cents,d.day,case when m.source_kind='training' then 1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') else 1::numeric end from public.valid_manual_service_periods m
 cross join lateral (
  select day::date as day from generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day where m.source_kind='manual'
  union all select (x->>'day')::date from jsonb_array_elements(m.days) x where m.source_kind='training' and x->>'status' in ('worked','rest')
 ) d where m.package_reviewed
), fractions as (
 select *,weight/sum(weight) over(partition by line_id,service) as fraction from sources
), shares as (
 select *,floor(abs(amount_cents::numeric)*fraction) as whole,abs(amount_cents::numeric)*fraction-floor(abs(amount_cents::numeric)*fraction) as remainder from fractions
)
select line_id,invoice_id,service,day,sign(amount_cents::numeric)*(whole+case when row_number() over(partition by line_id,service order by remainder desc,day)<=abs(amount_cents::numeric)-sum(whole) over(partition by line_id,service) then 1 else 0 end) as cents from shares;
revoke all on public.dated_service_revenue from public,anon,authenticated;

create or replace view public.dated_feed_revenue with(security_invoker=true) as
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
 union all
 select m.line_id,m.invoice_id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,m.feed_cents,m.horse_id,d.day,
  case when m.source_kind='training' then 1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') else 1::numeric end,d.day::text,'package',m.stay_id
 from public.valid_manual_service_periods m join public.invoices i on i.id=m.invoice_id
 cross join lateral (
  select day::date as day from generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day where m.source_kind='manual'
  union all select (x->>'day')::date from jsonb_array_elements(m.days) x where m.source_kind='training' and x->>'status' in ('worked','rest')
 ) d where m.package_reviewed
 ), weighted as (
  select *,case when sum(weight) over(partition by line_id)=0 then 1::numeric/count(*) over(partition by line_id)
   else weight/sum(weight) over(partition by line_id) end as fraction from charge_sources
 ), shares as (
  select *,floor(abs(amount_cents::numeric)*fraction) as whole,abs(amount_cents::numeric)*fraction-floor(abs(amount_cents::numeric)*fraction) as remainder from weighted
 ), allocated as (
  -- Largest remainder reconciles every saved line to exact cents, with stable ties.
  select *,sign(amount_cents::numeric)*(whole+case when row_number() over(partition by line_id order by remainder desc,service_date,tie_key)
    <=abs(amount_cents::numeric)-sum(whole) over(partition by line_id) then 1 else 0 end) as cents from shares
 ) select * from allocated;
revoke all on public.dated_feed_revenue from public,anon,authenticated;
create or replace view public.manual_package_review_queue with(security_invoker=true) as
select a.line_id,a.invoice_id,c.horse_id,c.stay_id,a.feed_cents,a.covered_from,a.covered_to,i.status,i.invoice_number,i.issue_date,l.description
from public.manual_service_periods a join public.invoice_lines l on l.id=a.line_id join public.invoices i on i.id=l.invoice_id
join public.service_invoice_context c on c.invoice_id=i.id
where a.retired_at is null and a.package_reviewed and a.invoice_id=i.id and i.status in ('draft','issued')
 and ((a.source_kind='manual' and l.kind='manual' and l.billing_category='training') or (a.source_kind='training' and l.kind='training' and (not a.cleared or not exists(select 1 from public.invoice_day_claims d where d.line_id=l.id))))
 and not exists(select 1 from public.valid_manual_service_periods v where v.allocation_id=a.id);
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
 left join public.dated_package_reporting p on p.line_id=l.id
 where i.status='issued' and l.kind='training' and i.issue_date between p_from and p_to
 union all
 select l.id,l.invoice_id,i.invoice_number,i.issue_date,h.barn_name,l.amount_cents,p.feed_cents,p.board_cents,case when p.line_id is not null then l.amount_cents-p.feed_cents-p.board_cents end,
 exists(select 1 from public.invoice_adjustments a where a.invoice_id=i.id)
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.manual_service_periods r on r.line_id=l.id and r.invoice_id=i.id and r.retired_at is null and r.package_reviewed
 join public.service_invoice_context c on c.invoice_id=i.id left join public.horses h on h.id=c.horse_id
 left join public.valid_manual_service_periods p on p.line_id=l.id
 where i.status='issued' and l.kind='manual' and i.issue_date between p_from and p_to
 ) select jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(x) order by issue_date,invoice_id,id) from lines x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'invoice_id',a.invoice_id,'invoice_number',i.invoice_number,'amount_cents',a.amount_cents,'adjustment_date',a.adjustment_date,'description',a.description,'allocation',case when r.id is null then null else to_jsonb(r)-'created_by'-'retired_at' end) order by a.adjustment_date,a.id) from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null where i.status='issued' and i.issue_date between p_from and p_to and exists(select 1 from lines l where l.invoice_id=i.id)),'[]'::jsonb),
 'totals',(select jsonb_build_object('feed_cents',coalesce(sum(feed_cents),0),'board_cents',coalesce(sum(board_cents),0),'training_cents',coalesce(sum(training_cents),0),'unallocated_cents',coalesce(sum(amount_cents) filter(where feed_cents is null),0)) from lines)) into result;
 return result;
end; $$;
revoke all on function public.package_revenue_report(date,date) from public,anon;
grant execute on function public.package_revenue_report(date,date) to authenticated;
create or replace function public.feed_charge_comparison(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
  where (l.billing_category='feed' and not exists(select 1 from allocated c where c.line_id=l.id)) or exists(select 1 from public.manual_package_review_queue q where q.line_id=l.id)
 ), adjustment_days as (
  select a.id as adjustment_id,c.invoice_id,c.horse_id,c.service_date,
   r.feed_cents::bigint as amount_cents,
   sign(a.amount_cents::numeric) as direction,sum(greatest(c.cents,0)) as weight
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
    and not exists(select 1 from public.valid_manual_service_periods mp where mp.stay_id=s.id and mp.package_reviewed and mp.covered_from<=p_to and mp.covered_to>=p_from)
    or exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id
     where i.stay_id=s.id and i.status in ('draft','issued') and l.kind='training' and i.period_from<=p_to and i.period_to>=p_from
     and not exists(select 1 from public.effective_package_reporting p where p.line_id=l.id and (p.feed_cents>0 or p.feed_included is not null)))
   )) as included
  from public.training_stays s join public.customers c on c.id=s.billing_customer_id
  where s.arrival_date<=p_to and (s.departure_date is null or s.departure_date>=p_from) group by s.horse_id
 ), invoice_parts as (
  select horse_id,invoice_id,status,invoice_number,customer_id,coalesce(customer_snapshot->>'name',max(c.name)) as customer_name,
   period_from,period_to,issue_date,sum(cents) as cents,bool_or(basis='actual_cost') as actual_cost,bool_or(basis='manual_period' or basis='package' and exists(select 1 from public.valid_manual_service_periods mp where mp.line_id=pc.line_id and mp.package_reviewed)) as manual_period,
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
 union all
  select q.horse_id,q.line_id,q.invoice_id,q.invoice_number,q.status,q.description,q.feed_cents,q.issue_date,'Review package service dates, classifications and split' from public.manual_package_review_queue q
  where q.covered_from<=p_to and q.covered_to>=p_from
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
