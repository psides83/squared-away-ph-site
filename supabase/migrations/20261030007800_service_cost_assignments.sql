begin;
create table public.service_assignment_reviews (
 id uuid primary key,expense_id uuid not null references public.expenses(id),parent_id uuid not null references public.service_cost_allocations(id),
 submitted_rows jsonb not null,reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index current_service_assignment_review on public.service_assignment_reviews(expense_id) where retired_at is null;
create table public.service_assignment_lines (
 review_id uuid not null references public.service_assignment_reviews(id),position integer not null,
 service text not null check(service in ('training','board')),horse_id uuid not null references public.horses(id),horse_name text not null,
 stay_id uuid references public.training_stays(id),amount_cents bigint not null check(amount_cents between 1 and 100000000),
 covered_from date not null,covered_to date not null check(covered_to>=covered_from and covered_to-covered_from<=3660),
 primary key(review_id,position)
);
do $$declare t text;begin
 foreach t in array array['service_assignment_reviews','service_assignment_lines'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using((select public.is_admin()))',t);
 end loop;
end;$$;
create function public.set_service_assignments(p_request uuid,p_expense uuid,p_parent uuid,p_current uuid,p_rows jsonb,p_reason text,p_clear boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.service_assignment_reviews%rowtype;cur public.service_assignment_reviews%rowtype;p public.service_cost_allocations%rowtype;
 source public.service_cost_sources%rowtype;total_training bigint;total_board bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 perform 1 from public.expenses where id=p_expense for update;
 if not found then raise exception 'Expense not found';end if;
 select * into old from public.service_assignment_reviews where id=p_request;
 if found then
  if row(old.expense_id,old.parent_id,old.submitted_rows,old.reason,old.cleared) is distinct from row(p_expense,p_parent,p_rows,trim(p_reason),p_clear) then raise exception 'This request was already used with different values';end if;
  return old.id;
 end if;
 select * into cur from public.service_assignment_reviews where expense_id=p_expense and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'Assignments changed. Close and reopen this editor';end if;
 if p_request is null or p_clear is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or jsonb_typeof(p_rows) is distinct from 'array' or pg_column_size(p_rows)>30000 then raise exception 'Enter assignment rows and a private review reason';end if;
 select * into p from public.service_cost_allocations where id=p_parent and expense_id=p_expense;
 if not found then raise exception 'Choose the service split for this expense';end if;
 if p_clear then
  if cur.id is null or cur.cleared or cur.parent_id<>p_parent or p_rows<>'[]'::jsonb then raise exception 'Choose the current assignments to clear';end if;
 else
  select * into source from public.service_cost_sources where expense_id=p_expense;
  if source.expense_id is null or p.retired_at is not null or p.cleared or p.source_cents<>source.eligible_cents then raise exception 'Review the current business service split before assigning costs';end if;
  if jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Enter 1 to 50 portions, or explicitly clear assignments';end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object' or coalesce(r->>'service','') not in ('training','board') or coalesce(r->>'horse_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or (r->>'stay_id' is not null and r->>'stay_id'!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') or coalesce(r->>'amount_cents','')!~'^[0-9]{1,9}$' or coalesce(r->>'covered_from','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(r->>'covered_to','')!~'^\d{4}-\d{2}-\d{2}$') then raise exception 'Enter valid horses, stays, amounts and covered dates';end if;
  perform 1 from public.horses h join jsonb_array_elements(p_rows) r on h.id=(r->>'horse_id')::uuid for share of h;
  perform 1 from public.training_stays s join jsonb_array_elements(p_rows) r on s.id=(r->>'stay_id')::uuid for share of s;
  if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'amount_cents')::bigint not between 1 and 100000000
   or not exists(select 1 from public.horses h where h.id=(r->>'horse_id')::uuid)
   or source.horse_id is not null and source.horse_id<>(r->>'horse_id')::uuid
   or (r->>'covered_from')::date<p.covered_from or (r->>'covered_to')::date>p.covered_to or (r->>'covered_from')::date>(r->>'covered_to')::date
   or r->>'stay_id' is not null and not exists(select 1 from public.training_stays s where s.id=(r->>'stay_id')::uuid and s.horse_id=(r->>'horse_id')::uuid and (r->>'covered_from')::date>=s.arrival_date and (s.departure_date is null or (r->>'covered_to')::date<=s.departure_date))) then raise exception 'Portions must use the expense horse when assigned, and dates must fit the business split and selected stay';end if;
  select coalesce(sum((r->>'amount_cents')::bigint) filter(where r->>'service'='training'),0),coalesce(sum((r->>'amount_cents')::bigint) filter(where r->>'service'='board'),0) into total_training,total_board from jsonb_array_elements(p_rows) r;
  if total_training>p.training_cents or total_board>p.board_cents then raise exception 'Horse/stay portions cannot exceed their business service totals';end if;
 end if;
 update public.service_assignment_reviews set retired_at=now() where id=cur.id;
 insert into public.service_assignment_reviews(id,expense_id,parent_id,submitted_rows,reason,cleared,created_by) values(p_request,p_expense,p_parent,p_rows,trim(p_reason),p_clear,auth.uid());
 if not p_clear then
  insert into public.service_assignment_lines(review_id,position,service,horse_id,horse_name,stay_id,amount_cents,covered_from,covered_to)
  select p_request,n::integer,r->>'service',(r->>'horse_id')::uuid,h.barn_name,(r->>'stay_id')::uuid,(r->>'amount_cents')::bigint,(r->>'covered_from')::date,(r->>'covered_to')::date
  from jsonb_array_elements(p_rows) with ordinality x(r,n) join public.horses h on h.id=(r->>'horse_id')::uuid;
 end if;
 return p_request;
end;$$;
revoke all on function public.set_service_assignments(uuid,uuid,uuid,uuid,jsonb,text,boolean) from public,anon;
grant execute on function public.set_service_assignments(uuid,uuid,uuid,uuid,jsonb,text,boolean) to authenticated;
create view public.valid_service_assignments with(security_invoker=true) as
select a.* from public.service_assignment_reviews a join public.service_cost_allocations p on p.id=a.parent_id
join public.service_cost_sources s on s.expense_id=a.expense_id and s.eligible_cents=p.source_cents
where a.retired_at is null and not a.cleared and p.retired_at is null and not p.cleared
 and not exists(select 1 from public.service_assignment_lines l left join public.training_stays st on st.id=l.stay_id
 where l.review_id=a.id and (s.horse_id is not null and s.horse_id<>l.horse_id or l.covered_from<p.covered_from or l.covered_to>p.covered_to
 or l.stay_id is not null and (st.id is null or st.horse_id<>l.horse_id or l.covered_from<st.arrival_date or st.departure_date is not null and l.covered_to>st.departure_date)));
revoke all on public.valid_service_assignments from public,anon,authenticated;
grant select on public.valid_service_assignments to authenticated;
create view public.service_assignment_review_queue with(security_invoker=true) as
select a.expense_id,s.vendor,s.expense_date,p.covered_from as previous_from,p.covered_to as previous_to,n.covered_from as current_from,n.covered_to as current_to
from public.service_assignment_reviews a join public.service_cost_allocations p on p.id=a.parent_id
join public.service_cost_sources s on s.expense_id=a.expense_id and s.eligible_cents>0
left join public.service_cost_allocations n on n.expense_id=a.expense_id and n.retired_at is null
where a.retired_at is null and not a.cleared and not exists(select 1 from public.valid_service_assignments v where v.id=a.id);
revoke all on public.service_assignment_review_queue from public,anon,authenticated;
-- Assigned portions follow their own dates; the unassigned remainder follows the parent dates.
create view public.dated_service_costs with(security_invoker=true) as
with active_parents as (
 select p.* from public.service_cost_allocations p join public.service_cost_sources s on s.expense_id=p.expense_id and s.eligible_cents=p.source_cents where p.retired_at is null and not p.cleared
), portions as (
 select p.expense_id,p.id as allocation_id,l.service,l.horse_id,l.stay_id,l.amount_cents,l.covered_from,l.covered_to
 from active_parents p join public.valid_service_assignments a on a.parent_id=p.id join public.service_assignment_lines l on l.review_id=a.id
 union all
 select p.expense_id,p.id,v.service,null::uuid,null::uuid,v.cents-coalesce((select sum(l.amount_cents) from public.valid_service_assignments a join public.service_assignment_lines l on l.review_id=a.id where a.parent_id=p.id and l.service=v.service),0),p.covered_from,p.covered_to
 from active_parents p cross join lateral(values('training'::text,p.training_cents),('board',p.board_cents),('other',p.other_cents)) v(service,cents)
)
select expense_id,allocation_id,service,horse_id,stay_id,day::date,
 floor(amount_cents/(covered_to-covered_from+1))+case when day::date-covered_from<amount_cents%(covered_to-covered_from+1) then 1 else 0 end as cents
from portions cross join lateral generate_series(covered_from::timestamp,covered_to::timestamp,interval '1 day') day where amount_cents>0;
revoke all on public.dated_service_costs from public,anon,authenticated;
create view public.dated_service_adjustments with(security_invoker=true) as
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
  select a.id,a.invoice_id,a.service,a.amount_cents,a.direction,d.day,sum(d.cents) as weight
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
   and coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from
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
create function public.service_assignment_options(p_expense uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select jsonb_build_object('expense_id',p_expense,
 'source_horse_id',(select horse_id from public.service_cost_sources where expense_id=p_expense),
 'parent',(select to_jsonb(p) from public.service_cost_allocations p join public.service_cost_sources s on s.expense_id=p.expense_id and s.eligible_cents=p.source_cents where p.expense_id=p_expense and p.retired_at is null and not p.cleared),
 'current',(select to_jsonb(a)-'created_by'||jsonb_build_object('valid',exists(select 1 from public.valid_service_assignments v where v.id=a.id),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by position) from public.service_assignment_lines l where l.review_id=a.id),'[]'::jsonb)) from public.service_assignment_reviews a where a.expense_id=p_expense and a.retired_at is null),
 'history',coalesce((select jsonb_agg(to_jsonb(x)) from(select a.id,a.parent_id,a.reason,a.cleared,a.created_at,a.retired_at,
  coalesce((select jsonb_agg(to_jsonb(l) order by position) from public.service_assignment_lines l where l.review_id=a.id),'[]'::jsonb) as lines
  from public.service_assignment_reviews a where a.expense_id=p_expense order by a.created_at desc,a.id limit 10)x),'[]'::jsonb),
 'horses',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,barn_name from public.horses order by barn_name,id limit 1000)x),'[]'::jsonb),
 'stays',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,horse_id,arrival_date,departure_date from public.training_stays order by arrival_date desc,id limit 2000)x),'[]'::jsonb),
 'options_truncated',(select count(*)>1000 from public.horses) or (select count(*)>2000 from public.training_stays)) into result;
 return result;
end;$$;
revoke all on function public.service_assignment_options(uuid) from public,anon;
grant execute on function public.service_assignment_options(uuid) to authenticated;
create function public.service_entity_margins(p_from date,p_to date,p_scope text default 'horse',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare business jsonb;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('horse','stay') or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid scope and page';end if;
 business:=public.service_profitability(p_from,p_to);
 with revenue as (
  select case when p_scope='horse' then s.horse_id else i.stay_id end as entity_id,d.service,d.cents,i.status
  from public.dated_service_revenue d join public.invoices i on i.id=d.invoice_id left join public.training_stays s on s.id=i.stay_id
  where i.status in ('draft','issued') and d.day between p_from and p_to
 ), adjustments as (
  select case when p_scope='horse' then s.horse_id else i.stay_id end as entity_id,d.service,d.cents
  from public.dated_service_adjustments d join public.invoices i on i.id=d.invoice_id left join public.training_stays s on s.id=i.stay_id
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
commit;
