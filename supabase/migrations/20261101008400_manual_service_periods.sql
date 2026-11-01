begin;
create table public.manual_service_periods (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),line_id uuid not null,
 horse_id uuid not null references public.horses(id),stay_id uuid references public.training_stays(id),
 service text not null check(service in ('training','board')),amount_cents integer not null check(amount_cents between -100000000 and 100000000),
 covered_from date not null,covered_to date not null check(covered_to>=covered_from and covered_to-covered_from<=3660),
 source_token text not null,days jsonb,reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index current_manual_service_period on public.manual_service_periods(line_id) where retired_at is null;
alter table public.manual_service_periods enable row level security;
revoke all on public.manual_service_periods from public,anon,authenticated;
grant select on public.manual_service_periods to authenticated;
create policy admin_read on public.manual_service_periods for select to authenticated using((select public.is_admin()));
create view public.service_invoice_context with(security_invoker=true) as
select i.id as invoice_id,coalesce(s.horse_id,r.horse_id) as horse_id,coalesce(i.stay_id,r.stay_id) as stay_id
from public.invoices i left join public.training_stays s on s.id=i.stay_id
left join public.invoice_reporting_links r on r.invoice_id=i.id and r.retired_at is null and i.stay_id is null;
revoke all on public.service_invoice_context from public,anon,authenticated;
create view public.manual_service_sources with(security_invoker=true) as
select l.id as line_id,i.id as invoice_id,l.description,l.amount_cents,case when l.billing_category='boarding' then 'board' else 'training' end as service,
 i.status,i.issue_date,i.period_from,i.period_to,c.horse_id,c.stay_id,s.arrival_date,s.departure_date,
 md5(jsonb_build_array(l.id,i.id,l.amount_cents,l.billing_category,c.horse_id,c.stay_id,s.arrival_date,s.departure_date,
 case when l.billing_category='training' then (select jsonb_agg(jsonb_build_object('day',d.day,'status',d.status) order by d.day) from public.training_days d where d.stay_id=c.stay_id) end)::text) as source_token
from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
left join public.training_stays s on s.id=c.stay_id
where l.kind='manual' and l.billing_category in ('training','boarding') and i.status in ('draft','issued');
revoke all on public.manual_service_sources from public,anon,authenticated;
create view public.valid_manual_service_periods with(security_invoker=true) as
select s.*,a.id as allocation_id,a.covered_from,a.covered_to,a.days
from public.manual_service_sources s join public.manual_service_periods a on a.line_id=s.line_id and a.retired_at is null and not a.cleared
where a.invoice_id=s.invoice_id and a.amount_cents=s.amount_cents and a.horse_id=s.horse_id and a.stay_id is not distinct from s.stay_id and a.service=s.service
 and (s.stay_id is null or a.covered_from>=s.arrival_date and (s.departure_date is null or a.covered_to<=s.departure_date))
 and (a.service='board' or a.stay_id is not null and a.days=(select jsonb_agg(jsonb_build_object('day',d.day,'status',d.status) order by d.day) from public.training_days d where d.stay_id=a.stay_id and d.day between a.covered_from and a.covered_to));
revoke all on public.valid_manual_service_periods from public,anon,authenticated;
create function public.set_manual_service_period(p_request uuid,p_line uuid,p_current uuid,p_horse uuid,p_stay uuid,p_amount integer,p_from date,p_to date,p_reason text,p_clear boolean default false,p_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.manual_service_periods%rowtype;cur public.manual_service_periods%rowtype;source public.manual_service_sources%rowtype;invoice uuid;days jsonb;kind text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into old from public.manual_service_periods where id=p_request;
 if found then invoice:=old.invoice_id;else select invoice_id into invoice from public.invoice_lines where id=p_line;end if;
 perform 1 from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found';end if;
 select * into old from public.manual_service_periods where id=p_request;
 if old.id is not null then
  if row(old.line_id,old.horse_id,old.stay_id,old.amount_cents,old.covered_from,old.covered_to,old.reason,old.cleared,old.source_token) is distinct from row(p_line,p_horse,p_stay,p_amount,p_from,p_to,trim(p_reason),p_clear,p_token) then raise exception 'This request was already used with different values';end if;
  return old.id;
 end if;
 select * into cur from public.manual_service_periods where line_id=p_line and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The service period changed. Close and reopen this editor';end if;
 if p_request is null or p_clear is null or p_horse is null or p_amount is null or p_amount not between -100000000 and 100000000 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_token is null or length(p_token)<>32 then raise exception 'Enter current source details, valid covered dates and a private reason';end if;
 if p_clear then
  if cur.id is null or cur.cleared or row(cur.horse_id,cur.stay_id,cur.amount_cents,cur.covered_from,cur.covered_to,cur.source_token) is distinct from row(p_horse,p_stay,p_amount,p_from,p_to,p_token) then raise exception 'Choose the current saved service period to clear';end if;
  kind:=cur.service;days:=cur.days;
 else
  if p_stay is not null then perform 1 from public.training_stays where id=p_stay for update;end if;
  select * into source from public.manual_service_sources where line_id=p_line;
  if not found then raise exception 'Choose a manual training or board line on a draft or finalized invoice';end if;
  if row(source.horse_id,source.stay_id,source.amount_cents,source.source_token) is distinct from row(p_horse,p_stay,p_amount,p_token) then raise exception 'The invoice assignment, charge or training-day records changed. Close and reopen this editor';end if;
  if p_stay is not null and (p_from<source.arrival_date or source.departure_date is not null and p_to>source.departure_date) then raise exception 'Covered dates must fit the assigned stay';end if;
  kind:=source.service;
  if kind='training' then
   if p_stay is null then raise exception 'Assign this invoice to a training stay before reviewing training days';end if;
   if p_to>(now() at time zone 'America/Chicago')::date then raise exception 'Review elapsed training days only';end if;
   select jsonb_agg(jsonb_build_object('day',d.day,'status',d.status) order by d.day) into days from public.training_days d where d.stay_id=p_stay and d.day between p_from and p_to;
   if coalesce(jsonb_array_length(days),0)<>p_to-p_from+1 then raise exception 'Classify every covered stay day before reviewing training revenue';end if;
   if not exists(select 1 from jsonb_array_elements(days) d where d->>'status' in ('worked','rest')) then raise exception 'No worked or billable-rest days in this period';end if;
  end if;
 end if;
 update public.manual_service_periods set retired_at=now() where id=cur.id;
 insert into public.manual_service_periods(id,invoice_id,line_id,horse_id,stay_id,service,amount_cents,covered_from,covered_to,source_token,days,reason,cleared,created_by)
 values(p_request,invoice,p_line,p_horse,p_stay,kind,p_amount,p_from,p_to,p_token,days,trim(p_reason),p_clear,auth.uid());
 return p_request;
end;$$;
revoke all on function public.set_manual_service_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean,text) from public,anon;
grant execute on function public.set_manual_service_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean,text) to authenticated;
create function public.manual_service_reporting(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with rows as (
 select l.id,l.description,l.amount_cents,case when l.billing_category='boarding' then 'board' else 'training' end as service,i.status,i.issue_date,i.period_from,i.period_to,c.horse_id,c.stay_id,h.barn_name as horse_name,s.source_token,
 a.id is not null and not a.cleared as has_saved_period,exists(select 1 from public.valid_manual_service_periods v where v.line_id=l.id) as valid,
 case when a.id is null then null else to_jsonb(a)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.manual_service_periods x where x.line_id=l.id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
 left join public.horses h on h.id=c.horse_id left join public.manual_service_sources s on s.line_id=l.id
 left join public.manual_service_periods a on a.line_id=l.id and a.retired_at is null
 where i.id=p_invoice and l.kind='manual' and l.billing_category in ('training','boarding')
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rows order by id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.manual_service_reporting(uuid,integer) from public,anon;
grant execute on function public.manual_service_reporting(uuid,integer) to authenticated;
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
 select m.line_id,m.invoice_id,m.service,m.amount_cents,d.day,1::numeric
 from public.valid_manual_service_periods m cross join lateral (
  select day::date as day from generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day where m.service='board'
  union all select (x->>'day')::date from jsonb_array_elements(m.days) x where m.service='training' and x->>'status' in ('worked','rest')
 ) d
), fractions as (
 select *,weight/sum(weight) over(partition by line_id,service) as fraction from sources
), shares as (
 select *,floor(abs(amount_cents::numeric)*fraction) as whole,abs(amount_cents::numeric)*fraction-floor(abs(amount_cents::numeric)*fraction) as remainder from fractions
)
select line_id,invoice_id,service,day,sign(amount_cents::numeric)*(whole+case when row_number() over(partition by line_id,service order by remainder desc,day)<=abs(amount_cents::numeric)-sum(whole) over(partition by line_id,service) then 1 else 0 end) as cents from shares;
revoke all on public.dated_service_revenue from public,anon,authenticated;

create or replace view public.dated_service_adjustments with(security_invoker=true) as
 with revenue as (
  select d.*,i.status from public.dated_service_revenue d join public.invoices i on i.id=d.invoice_id where i.status in ('draft','issued')
 ), unsupported as (
  select l.id,l.invoice_id,i.invoice_number,l.amount_cents,l.description
  from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  where i.status='issued' and (l.kind='training' or l.billing_category in ('training','boarding'))
   and not exists(select 1 from revenue d where d.line_id=l.id)
 ), adjustments as (
  select a.id,a.invoice_id,v.service,v.amount_cents,sign(a.amount_cents::numeric) as direction
  from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id and i.status='issued'
  join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  cross join lateral(values('training'::text,r.training_cents),('board',r.board_cents)) v(service,amount_cents)
  where v.amount_cents>0 and not exists(select 1 from unsupported u where u.invoice_id=a.invoice_id)
 ), adjustment_days as (
  select a.id,a.invoice_id,a.service,a.amount_cents,a.direction,d.day,sum(greatest(d.cents,0)) as weight
  from adjustments a join revenue d on d.invoice_id=a.invoice_id and d.service=a.service and d.status='issued'
  group by a.id,a.invoice_id,a.service,a.amount_cents,a.direction,d.day
 ), adjustment_fractions as (
  select *,case when sum(weight) over(partition by id,service)=0 then 1::numeric/count(*) over(partition by id,service) else weight/sum(weight) over(partition by id,service) end as fraction from adjustment_days
 ), adjustment_shares as (
  select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from adjustment_fractions
 ), dated_adjustments as (
  select *,direction*(whole+case when row_number() over(partition by id,service order by remainder desc,day)<=amount_cents-sum(whole) over(partition by id,service) then 1 else 0 end) as cents from adjustment_shares
 )
select id as adjustment_id,invoice_id,service,day,cents from dated_adjustments;
revoke all on public.dated_service_adjustments from public,anon,authenticated;
create or replace function public.service_profitability(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from) or exists(select 1 from public.manual_service_periods m where m.line_id=l.id and m.retired_at is null and m.covered_from<=p_to and m.covered_to>=p_from))
   and not exists(select 1 from revenue d where d.line_id=l.id)
 ), dated_adjustments as (select adjustment_id as id,invoice_id,service,day,cents from public.dated_service_adjustments
 ), unresolved_adjustments as (
  select distinct a.id,a.invoice_id,i.invoice_number from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id
  left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  where i.status='issued' and (exists(select 1 from revenue d where d.invoice_id=i.id and d.day between p_from and p_to) or coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
   and (r.id is null or r.training_cents>0 and not exists(select 1 from dated_adjustments d where d.id=a.id and d.service='training') or r.board_cents>0 and not exists(select 1 from dated_adjustments d where d.id=a.id and d.service='board'))
 ), cost_days as (select * from public.dated_service_costs where day between p_from and p_to
 ), unresolved_costs as (
  select s.*,a.id as allocation_id from public.service_cost_sources s left join public.service_cost_allocations a on a.expense_id=s.expense_id and a.retired_at is null
  where s.eligible_cents>0 and (a.id is null or a.cleared or a.source_cents<>s.eligible_cents)
   and (s.expense_date between p_from and p_to or a.covered_from<=p_to and a.covered_to>=p_from)
 ), service_rows as (
  select service,
   coalesce((select sum(cents) from revenue d where d.service=v.service and d.status='issued' and d.day between p_from and p_to),0) as gross_cents,
   coalesce((select sum(cents) from dated_adjustments d where d.service=v.service and d.day between p_from and p_to),0) as adjustment_cents,
   coalesce((select sum(cents) from revenue d where d.service=v.service and d.status='draft' and d.day between p_from and p_to),0) as draft_cents,
   coalesce((select sum(cents) from cost_days d where d.service=v.service and d.day between p_from and p_to),0) as cost_cents
  from(values('training'::text),('board')) v(service)
 ) select jsonb_build_object('services',coalesce((select jsonb_agg(to_jsonb(r) order by service desc) from service_rows r),'[]'::jsonb),
 'invalid_assignment_count',(select count(*) from public.service_assignment_review_queue where previous_from<=p_to and previous_to>=p_from or current_from<=p_to and current_to>=p_from),
 'assignment_review',coalesce((select jsonb_agg(to_jsonb(x)) from(select expense_id,vendor,expense_date from public.service_assignment_review_queue where previous_from<=p_to and previous_to>=p_from or current_from<=p_to and current_to>=p_from order by expense_id limit 25)x),'[]'::jsonb),
 'other_cost_cents',(select coalesce(sum(cents),0) from cost_days where service='other' and day between p_from and p_to),
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
create or replace function public.service_entity_margins(p_from date,p_to date,p_scope text default 'horse',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare business jsonb;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('horse','stay') or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid scope and page';end if;
 business:=public.service_profitability(p_from,p_to);
 with revenue as (
  select case when p_scope='horse' then s.horse_id else s.stay_id end as entity_id,d.service,d.cents,i.status
  from public.dated_service_revenue d join public.invoices i on i.id=d.invoice_id left join public.service_invoice_context s on s.invoice_id=i.id
  where i.status in ('draft','issued') and d.day between p_from and p_to
 ), adjustments as (
  select case when p_scope='horse' then s.horse_id else s.stay_id end as entity_id,d.service,d.cents
  from public.dated_service_adjustments d join public.invoices i on i.id=d.invoice_id left join public.service_invoice_context s on s.invoice_id=i.id
  where d.day between p_from and p_to
 ), costs as (
  select case when p_scope='horse' then horse_id else stay_id end as entity_id,service,cents from public.dated_service_costs where day between p_from and p_to and service in ('training','board')
 ), ids as (select entity_id from revenue union select entity_id from adjustments union select entity_id from costs),
 entities as (
  select h.id as entity_id,h.id as horse_id,null::uuid as stay_id,h.barn_name as name,null::date as arrival_date,null::date as departure_date from public.horses h where p_scope='horse'
  union all select s.id,s.horse_id,s.id,h.barn_name,s.arrival_date,s.departure_date from public.training_stays s join public.horses h on h.id=s.horse_id where p_scope='stay'
 ), matched as (select e.* from entities e join ids on ids.entity_id=e.entity_id),
 rev as (select entity_id,service,coalesce(sum(cents) filter(where status='issued'),0) as gross_cents,coalesce(sum(cents) filter(where status='draft'),0) as draft_cents from revenue group by entity_id,service),
 adj as (select entity_id,service,sum(cents) as adjustment_cents from adjustments group by entity_id,service),
 cost as (select entity_id,service,sum(cents) as cost_cents from costs group by entity_id,service),
 summary as (
  select ids.entity_id,v.service,coalesce(r.gross_cents,0) as gross_cents,coalesce(r.draft_cents,0) as draft_cents,coalesce(a.adjustment_cents,0) as adjustment_cents,coalesce(c.cost_cents,0) as cost_cents
  from ids cross join(values('training'::text),('board')) v(service)
  left join rev r on r.entity_id is not distinct from ids.entity_id and r.service=v.service
  left join adj a on a.entity_id is not distinct from ids.entity_id and a.service=v.service
  left join cost c on c.entity_id is not distinct from ids.entity_id and c.service=v.service
 ), invalid_reviews as (
  select expense_id,vendor,expense_date from public.service_assignment_review_queue where previous_from<=p_to and previous_to>=p_from or current_from<=p_to and current_to>=p_from
 ), page as (select * from matched order by name,arrival_date,entity_id offset (p_page-1)*25 limit 25)
 select jsonb_build_object('scope',p_scope,'count',(select count(*) from matched),'rows',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('services',(select jsonb_agg(to_jsonb(s)-'entity_id' order by service desc) from summary s where s.entity_id=e.entity_id)) order by name,arrival_date,entity_id) from page e),'[]'::jsonb),
 'assigned_totals',coalesce((select jsonb_agg(to_jsonb(t) order by service desc) from(select service,sum(gross_cents) as gross_cents,sum(draft_cents) as draft_cents,sum(adjustment_cents) as adjustment_cents,sum(cost_cents) as cost_cents from summary where entity_id is not null group by service)t),'[]'::jsonb),
 'unassigned',coalesce((select jsonb_agg(to_jsonb(t)-'entity_id' order by service desc) from summary t where entity_id is null),'[]'::jsonb),
 'business_services',business->'services','unallocated_cost_count',business->'unallocated_cost_count','unsupported_revenue_count',business->'unsupported_revenue_count','unresolved_adjustment_count',business->'unresolved_adjustment_count',
 'invalid_assignment_count',(select count(*) from invalid_reviews),'assignment_review',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from invalid_reviews order by expense_id limit 25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.service_entity_margins(date,date,text,integer) from public,anon;
grant execute on function public.service_entity_margins(date,date,text,integer) to authenticated;
create or replace function public.combined_entity_profitability(p_from date,p_to date,p_scope text default 'horse',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare business jsonb;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('horse','stay') or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid scope and page';end if;
 business:=public.combined_service_profitability(p_from,p_to);
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
 ), facts as (
  select case when p_scope='horse' then horse_id else stay_id end as entity_id,'feed'::text as service,0::numeric as gross_cents,0::numeric as adjustment_cents,0::numeric as draft_cents,cost_cents,feeding_lines
  from costs
  union all
  select case when p_scope='horse' then horse_id else stay_id end,'feed',case when status='issued' then cents else 0 end,0,case when status='draft' then cents else 0 end,0,0
  from public.dated_feed_revenue where service_date between p_from and p_to
  union all
  select case when p_scope='horse' then horse_id else stay_id end,'feed',0,cents,0,0,0 from public.dated_feed_adjustments where service_date between p_from and p_to
  union all
  select case when p_scope='horse' then s.horse_id else s.stay_id end,d.service,case when i.status='issued' then d.cents else 0 end,0,case when i.status='draft' then d.cents else 0 end,0,0
  from public.dated_service_revenue d join public.invoices i on i.id=d.invoice_id left join public.service_invoice_context s on s.invoice_id=i.id
  where i.status in ('draft','issued') and d.day between p_from and p_to
  union all
  select case when p_scope='horse' then s.horse_id else s.stay_id end,d.service,0,d.cents,0,0,0
  from public.dated_service_adjustments d join public.invoices i on i.id=d.invoice_id left join public.service_invoice_context s on s.invoice_id=i.id where d.day between p_from and p_to
  union all
  select case when p_scope='horse' then horse_id else stay_id end,service,0,0,0,cents,0 from public.dated_service_costs
  where service in ('training','board') and day between p_from and p_to
 ), entities as (
  select h.id as entity_id,h.id as horse_id,null::uuid as stay_id,h.barn_name as name,null::date as arrival_date,null::date as departure_date,null::text as customer_name from public.horses h where p_scope='horse'
  union all select s.id,s.horse_id,s.id,h.barn_name,s.arrival_date,s.departure_date,c.name from public.training_stays s join public.horses h on h.id=s.horse_id join public.customers c on c.id=s.billing_customer_id where p_scope='stay'
 ), ids as (
  select entity_id from facts
  union select case when p_scope='horse' then horse_id else id end from public.training_stays where arrival_date<=p_to and (departure_date is null or departure_date>=p_from)
 ), summaries as (
  select ids.entity_id,v.service,coalesce(sum(f.gross_cents),0) as gross_cents,coalesce(sum(f.adjustment_cents),0) as adjustment_cents,
   coalesce(sum(f.draft_cents),0) as draft_cents,coalesce(sum(f.cost_cents),0) as cost_cents,coalesce(sum(f.feeding_lines),0) as feeding_lines
  from ids cross join(values('feed'::text),('board'),('training')) v(service)
  left join facts f on f.entity_id is not distinct from ids.entity_id and f.service=v.service group by ids.entity_id,v.service
 ), rows as (
  select e.*,sum(s.gross_cents+s.adjustment_cents) as net_cents,sum(s.cost_cents) as cost_cents,sum(s.draft_cents) as draft_cents,
   sum(s.feeding_lines) as feeding_lines,jsonb_agg(to_jsonb(s)-'entity_id'-'feeding_lines' order by service) as services,
   (business#>>'{review,needs_review}')::boolean as business_review,
   exists(select 1 from public.training_stays st where (p_scope='horse' and st.horse_id=e.horse_id or p_scope='stay' and st.id=e.stay_id)
    and st.arrival_date<=p_to and (st.departure_date is null or st.departure_date>=p_from) and st.feed_billing='included'
    and not exists(select 1 from public.effective_package_reporting p join public.invoice_lines l on l.id=p.line_id join public.invoices i on i.id=l.invoice_id
     join public.invoice_day_claims d on d.line_id=l.id where i.stay_id=st.id and i.status in ('draft','issued') and (p.feed_cents>0 or p.feed_included is not null) and d.day between p_from and p_to)) as package_review
  from entities e join ids on ids.entity_id=e.entity_id join summaries s on s.entity_id=e.entity_id group by e.entity_id,e.horse_id,e.stay_id,e.name,e.arrival_date,e.departure_date,e.customer_name
 ), reviewed as (
  select *,business_review or package_review or feeding_lines=0 as needs_review from rows
 ), final_rows as (
  select *,case when not needs_review then net_cents-cost_cents end as difference_cents,
   case when not needs_review and net_cents>0 then round((net_cents-cost_cents)*100/net_cents,2) end as margin_percent from reviewed
 ), totals as (
  select service,sum(gross_cents) as gross_cents,sum(adjustment_cents) as adjustment_cents,sum(draft_cents) as draft_cents,sum(cost_cents) as cost_cents
  from summaries where entity_id is not null group by service
 ) select jsonb_build_object('scope',p_scope,'count',(select count(*) from final_rows),'business',business,
  'rows',coalesce((select jsonb_agg(to_jsonb(x) order by name,arrival_date desc,entity_id) from(select * from final_rows order by name,arrival_date desc,entity_id limit 25 offset (p_page-1)*25)x),'[]'::jsonb),
  'assigned_totals',coalesce((select jsonb_agg(to_jsonb(t) order by service) from totals t),'[]'::jsonb),
  'unassigned',coalesce((select jsonb_agg(to_jsonb(t)-'entity_id'-'feeding_lines' order by service) from summaries t where entity_id is null),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.combined_entity_profitability(date,date,text,integer) from public,anon;
grant execute on function public.combined_entity_profitability(date,date,text,integer) to authenticated;
commit;
