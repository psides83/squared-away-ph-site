begin;
-- Recognize the one-calendar-month source format used by add_monthly_service.
create or replace view public.monthly_service_sources with(security_invoker=true) as
select l.id as line_id,l.invoice_id,l.description,l.amount_cents,l.billing_category as service,
 i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.issue_date,i.period_from,i.period_to,c.horse_id,c.stay_id,s.arrival_date,s.departure_date,
 not exists(select 1 from public.invoice_service_days d where d.line_id=l.id)
 and not exists(select 1 from public.invoice_feed_claims f where f.line_id=l.id)
 and not exists(select 1 from public.invoice_boarding_claims b where b.line_id=l.id) as missing_sources,
 md5(jsonb_build_array(l.id,l.invoice_id,l.kind,l.billing_category,l.amount_cents,l.source_snapshot,c.horse_id,c.stay_id,s.arrival_date,s.departure_date)::text) as source_token,
 jsonb_build_object('line_id',l.id,'invoice_id',l.invoice_id,'kind',l.kind,'service',l.billing_category,'amount_cents',l.amount_cents,'snapshot',l.source_snapshot,'horse_id',c.horse_id,'stay_id',c.stay_id,'arrival_date',s.arrival_date,'departure_date',s.departure_date) as captured_source
from public.invoice_lines l join public.invoices i on i.id=l.invoice_id join public.service_invoice_context c on c.invoice_id=i.id
left join public.training_stays s on s.id=c.stay_id
where l.kind='service' and l.billing_category in ('feed','boarding') and l.source_snapshot->>'service'=l.billing_category
 and l.source_snapshot->>'basis' in ('calendar_segments','physical_days') and l.amount_cents>=0 and i.status in ('draft','issued');
revoke all on public.monthly_service_sources from public,anon,authenticated;
create or replace view public.valid_monthly_service_periods with(security_invoker=true) as
select s.*,r.id as allocation_id,r.covered_from,r.covered_to from public.monthly_service_sources s
join public.monthly_service_periods r on r.line_id=s.line_id and r.retired_at is null and not r.cleared
where s.missing_sources and s.source_token=r.source_token and s.invoice_id=r.invoice_id and s.service=r.service
 and s.horse_id=r.horse_id and s.stay_id=r.stay_id and s.amount_cents=r.amount_cents
 and ((select l.source_snapshot->>'basis' from public.invoice_lines l where l.id=s.line_id)<>'physical_days' or date_trunc('month',r.covered_from)=date_trunc('month',r.covered_to))
 and r.covered_from>=s.arrival_date and (s.departure_date is null or r.covered_to<=s.departure_date);
revoke all on public.valid_monthly_service_periods from public,anon,authenticated;
create or replace function public.set_monthly_service_period(p_request uuid,p_line uuid,p_current uuid,p_horse uuid,p_stay uuid,p_amount integer,p_from date,p_to date,p_reason text,p_clear boolean default false,p_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.monthly_service_periods%rowtype;cur public.monthly_service_periods%rowtype;s public.monthly_service_sources%rowtype;invoice uuid;service text;evidence jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into old from public.monthly_service_periods where id=p_request;
 if found then invoice:=old.invoice_id;else select invoice_id into invoice from public.invoice_lines where id=p_line;end if;
 perform 1 from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found';end if;
 select * into old from public.monthly_service_periods where id=p_request;
 if found then
  if row(old.line_id,old.horse_id,old.stay_id,old.amount_cents,old.covered_from,old.covered_to,old.reason,old.cleared,old.source_token) is distinct from row(p_line,p_horse,p_stay,p_amount,p_from,p_to,trim(p_reason),p_clear,p_token) then raise exception 'This request was already used with different values';end if;
  return old.id;
 end if;
 select * into cur from public.monthly_service_periods where line_id=p_line and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The monthly service period changed. Close and reopen this editor';end if;
 if p_request is null or p_clear is null or p_horse is null or p_stay is null or p_amount is null or p_amount not between 0 and 100000000 or p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_to>(now() at time zone 'America/Chicago')::date or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_token is null or length(p_token)<>32 then raise exception 'Enter a current horse/stay, elapsed covered dates, saved amount and private reason';end if;
 if p_clear then
  if cur.id is null or cur.cleared or row(cur.horse_id,cur.stay_id,cur.amount_cents,cur.covered_from,cur.covered_to,cur.source_token) is distinct from row(p_horse,p_stay,p_amount,p_from,p_to,p_token) then raise exception 'Choose the current saved monthly period to clear';end if;
  service:=cur.service;evidence:=cur.captured_source;
 else
  perform 1 from public.training_stays where id=p_stay for update;
  select * into s from public.monthly_service_sources where line_id=p_line;
  if not found or not s.missing_sources then raise exception 'Choose an eligible monthly feed or board charge without saved service sources';end if;
  if row(s.horse_id,s.stay_id,s.amount_cents,s.source_token) is distinct from row(p_horse,p_stay,p_amount,p_token) then raise exception 'The charge, source snapshot or horse/stay changed. Close and reopen this editor';end if;
  if p_from<s.arrival_date or s.departure_date is not null and p_to>s.departure_date then raise exception 'Covered dates must fit the assigned physical boarding stay';end if;
  if (select l.source_snapshot->>'basis' from public.invoice_lines l where l.id=p_line)='physical_days' and date_trunc('month',p_from)<>date_trunc('month',p_to) then raise exception 'Review a physical-day monthly charge within one calendar month';end if;
  service:=s.service;evidence:=s.captured_source;
 end if;
 update public.monthly_service_periods set retired_at=now() where id=cur.id;
 insert into public.monthly_service_periods(id,invoice_id,line_id,horse_id,stay_id,service,amount_cents,covered_from,covered_to,source_token,captured_source,reason,cleared,created_by)
 values(p_request,invoice,p_line,p_horse,p_stay,service,p_amount,p_from,p_to,p_token,evidence,trim(p_reason),p_clear,auth.uid());
 return p_request;
end;$$;
revoke all on function public.set_monthly_service_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean,text) from public,anon;
grant execute on function public.set_monthly_service_period(uuid,uuid,uuid,uuid,uuid,integer,date,date,text,boolean,text) to authenticated;
create or replace function public.monthly_service_reporting(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with rows as (
 select (select l.source_snapshot->>'basis' from public.invoice_lines l where l.id=s.line_id) as basis,
 case when s.captured_source->'snapshot'->>'period_from' ~ '^\d{4}-\d{2}-\d{2}$' then s.captured_source->'snapshot'->>'period_from' end as original_from,
 case when s.captured_source->'snapshot'->>'period_to' ~ '^\d{4}-\d{2}-\d{2}$' then s.captured_source->'snapshot'->>'period_to' end as original_to,
 s.line_id as id,s.description,s.amount_cents,s.service,s.status,s.issue_date,s.period_from,s.period_to,s.horse_id,s.stay_id,h.barn_name as horse_name,s.source_token,s.missing_sources,
 exists(select 1 from public.valid_monthly_service_periods v where v.line_id=s.line_id) as valid,
 case when r.id is null then null else to_jsonb(r)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.monthly_service_periods x where x.line_id=s.line_id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.monthly_service_sources s left join public.horses h on h.id=s.horse_id
 left join public.monthly_service_periods r on r.line_id=s.line_id and r.retired_at is null
 where s.invoice_id=p_invoice and (s.missing_sources or r.id is not null and not r.cleared)
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from rows order by id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.monthly_service_reporting(uuid,integer) from public,anon;
grant execute on function public.monthly_service_reporting(uuid,integer) to authenticated;

commit;
