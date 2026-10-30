begin;
create function public.combined_entity_profitability(p_from date,p_to date,p_scope text default 'horse',p_page integer default 1) returns jsonb
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
  select case when p_scope='horse' then s.horse_id else i.stay_id end,d.service,case when i.status='issued' then d.cents else 0 end,0,case when i.status='draft' then d.cents else 0 end,0,0
  from public.dated_service_revenue d join public.invoices i on i.id=d.invoice_id left join public.training_stays s on s.id=i.stay_id
  where i.status in ('draft','issued') and d.day between p_from and p_to
  union all
  select case when p_scope='horse' then s.horse_id else i.stay_id end,d.service,0,d.cents,0,0,0
  from public.dated_service_adjustments d join public.invoices i on i.id=d.invoice_id left join public.training_stays s on s.id=i.stay_id where d.day between p_from and p_to
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
