begin;
create table public.profit_inventory_reviews (
 id uuid primary key,source_kind text not null check(source_kind in ('correction','return','credit')),source_id uuid not null,
 source_token text not null,captured_source jsonb not null,effect text not null check(effect in ('none','cost','gain','settlement')),
 recognition_date date not null,submitted_cents bigint not null check(submitted_cents between 0 and 9007199254740991),
 profit_cents bigint not null check(profit_cents between -9007199254740991 and 9007199254740991),
 reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
-- Source IDs are polymorphic; private immutable evidence survives cancellations and reversals.
create unique index current_profit_inventory_review on public.profit_inventory_reviews(source_kind,source_id) where retired_at is null;
alter table public.profit_inventory_reviews enable row level security;
revoke all on public.profit_inventory_reviews from public,anon,authenticated;
grant select on public.profit_inventory_reviews to authenticated;
create policy admin_read on public.profit_inventory_reviews for select to authenticated using((select public.is_admin()));
create view public.profit_inventory_sources with(security_invoker=true) as
with sources as (
 select 'correction'::text as source_kind,m.id as source_id,m.kind as detail_kind,p.name as label,m.movement_date as source_date,m.movement_date as minimum_date,m.product_id,
 round(abs(m.value_delta_cents)) as stock_cents,0::numeric as cash_cents,0::numeric as credit_cents,null::integer as expected_cash_cents,null::integer as expected_credit_cents,
 jsonb_build_object('movement_id',m.id,'product_id',m.product_id,'kind',m.kind,'date',m.movement_date,'quantity',m.quantity_delta_oz,'value',m.value_delta_cents) as snapshot
 from public.inventory_movements m join public.inventory_products p on p.id=m.product_id
 where m.kind in ('adjustment_in','adjustment_out') and not exists(select 1 from public.supplier_returns r where r.movement_id=m.id) and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)
 union all
 select 'return',r.id,'supplier_return',r.vendor||' · '||p.name,m.movement_date,
 greatest(m.movement_date,coalesce(f.last_date,m.movement_date),coalesce(c.last_date,m.movement_date)),m.product_id,
 round(-m.value_delta_cents),f.cents,c.cents,e.cash_cents,e.credit_cents,
 jsonb_build_object('return_id',r.id,'movement_id',m.id,'product_id',m.product_id,'date',m.movement_date,'quantity',m.quantity_delta_oz,'value',m.value_delta_cents,'refunds',f.entries,'credits',c.entries,'expectations',jsonb_build_array(e.cash_cents,e.credit_cents))
 from public.supplier_returns r join public.inventory_movements m on m.id=r.movement_id join public.inventory_products p on p.id=m.product_id
 left join public.supplier_return_expectations e on e.return_id=r.id
 cross join lateral(select coalesce(sum(amount_cents),0)::numeric as cents,max(paid_on) as last_date,jsonb_agg(jsonb_build_array(id,amount_cents,paid_on) order by id) as entries from public.supplier_refunds where return_id=r.id and reversed_at is null) f
 cross join lateral(select coalesce(sum(amount_cents),0)::numeric as cents,max(issued_on) as last_date,jsonb_agg(jsonb_build_array(id,amount_cents,issued_on) order by id) as entries from public.supplier_credits where return_id=r.id and cancelled_at is null) c
 where r.cancelled_at is null and not exists(select 1 from public.inventory_movements rev where rev.reverses_id=m.id)
 union all
 select 'credit',c.id,'standalone_credit',c.vendor,c.issued_on,c.issued_on,null::uuid,c.amount_cents::numeric,0::numeric,c.amount_cents::numeric,null::integer,null::integer,
 jsonb_build_object('credit_id',c.id,'vendor',c.vendor_key,'date',c.issued_on,'amount',c.amount_cents)
 from public.supplier_credits c where c.return_id is null and c.cancelled_at is null
)
select s.*,md5(snapshot::text) as source_token from sources s;
revoke all on public.profit_inventory_sources from public,anon,authenticated;
create view public.valid_profit_inventory_reviews with(security_invoker=true) as
select r.* from public.profit_inventory_reviews r join public.profit_inventory_sources s on s.source_kind=r.source_kind and s.source_id=r.source_id and s.source_token=r.source_token
where r.retired_at is null and not r.cleared;
revoke all on public.valid_profit_inventory_reviews from public,anon,authenticated;
create function public.set_profit_inventory_review(p_request uuid,p_kind text,p_source uuid,p_current uuid,p_token text,p_effect text,p_date date,p_cents bigint,p_reason text,p_clear boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.profit_inventory_reviews%rowtype;cur public.profit_inventory_reviews%rowtype;s public.profit_inventory_sources%rowtype;product uuid;impact bigint;evidence jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_kind is null or p_kind not in ('correction','return','credit') or p_source is null then raise exception 'Choose a financial inventory source';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.profit_inventory_reviews where id=p_request;
 if found then
  if row(old.source_kind,old.source_id,old.source_token,old.effect,old.recognition_date,old.submitted_cents,old.reason,old.cleared) is distinct from row(p_kind,p_source,p_token,p_effect,p_date,p_cents,trim(p_reason),p_clear) then raise exception 'This request was already used with different values';end if;
  return old.id;
 end if;
 -- Product-first matches inventory revaluation and return cancellation; receipt writers also lock the return.
 if p_kind='correction' then select product_id into product from public.inventory_movements where id=p_source;
 elsif p_kind='return' then select m.product_id into product from public.supplier_returns r join public.inventory_movements m on m.id=r.movement_id where r.id=p_source;end if;
 if product is not null then perform 1 from public.inventory_products where id=product for update;end if;
 if p_kind='return' then perform 1 from public.supplier_returns where id=p_source for update;
 elsif p_kind='credit' then perform 1 from public.supplier_credits where id=p_source for update;end if;
 select * into cur from public.profit_inventory_reviews where source_kind=p_kind and source_id=p_source and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The financial review changed. Close and reopen this editor';end if;
 if p_clear is null or p_token is null or length(p_token)<>32 or p_effect is null or p_effect not in ('none','cost','gain','settlement') or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_cents is null or p_cents not between 0 and 9007199254740991 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a current source, valid actual date, effect and private reason';end if;
 if p_clear then
  if cur.id is null or cur.cleared or row(cur.source_token,cur.effect,cur.recognition_date,cur.submitted_cents) is distinct from row(p_token,p_effect,p_date,p_cents) then raise exception 'Choose the current saved financial review to clear';end if;
  impact:=cur.profit_cents;evidence:=cur.captured_source;
 else
  select * into s from public.profit_inventory_sources where source_kind=p_kind and source_id=p_source;
  if not found then raise exception 'Choose an active stock correction, supplier return or standalone supplier credit';end if;
  if s.source_token<>p_token then raise exception 'Stock values, refunds, credits or expectations changed. Close and reopen this editor';end if;
  if p_kind='return' then
   if p_effect<>'settlement' or p_date<s.minimum_date or p_cents<>abs(s.cash_cents+s.credit_cents-s.stock_cents) then raise exception 'Use the actual settlement date after all recorded receipts and the displayed return difference';end if;
   impact:=(s.cash_cents+s.credit_cents-s.stock_cents)::bigint;
  else
   if p_date<>s.source_date or p_effect='settlement' or p_effect='cost' and s.detail_kind<>'adjustment_out' or p_effect='gain' and s.detail_kind not in ('adjustment_in','standalone_credit') or p_cents<>(case when p_effect='none' then 0 else s.stock_cents end) then raise exception 'Choose no separate effect or the full displayed gain/loss on the recorded source date';end if;
   impact:=case when p_effect='none' then 0 when p_effect='cost' then -p_cents else p_cents end;
  end if;
  evidence:=to_jsonb(s);
 end if;
 update public.profit_inventory_reviews set retired_at=now() where id=cur.id;
 insert into public.profit_inventory_reviews(id,source_kind,source_id,source_token,captured_source,effect,recognition_date,submitted_cents,profit_cents,reason,cleared,created_by)
 values(p_request,p_kind,p_source,p_token,evidence,p_effect,p_date,p_cents,impact,trim(p_reason),p_clear,auth.uid());
 return p_request;
end;$$;
revoke all on function public.set_profit_inventory_review(uuid,text,uuid,uuid,text,text,date,bigint,text,boolean) from public,anon;
grant execute on function public.set_profit_inventory_review(uuid,text,uuid,uuid,text,text,date,bigint,text,boolean) to authenticated;
create function public.profit_inventory_options(p_kind text default 'return',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('correction','return','credit') or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid review category and page';end if;
 with rows as (
 select s.*,exists(select 1 from public.valid_profit_inventory_reviews v where v.id=r.id) as valid,
 case when r.id is null then null else to_jsonb(r)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.profit_inventory_reviews x where x.source_kind=s.source_kind and x.source_id=s.source_id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.profit_inventory_sources s left join public.profit_inventory_reviews r on r.source_kind=s.source_kind and r.source_id=s.source_id and r.retired_at is null where s.source_kind=p_kind
 ) select jsonb_build_object('kind',p_kind,'count',(select count(*) from rows),'pending_count',(select count(*) from rows where not valid),
 'rows',coalesce((select jsonb_agg(to_jsonb(x) order by source_date desc,source_id) from(select * from rows order by source_date desc,source_id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.profit_inventory_options(text,integer) from public,anon;
grant execute on function public.profit_inventory_options(text,integer) to authenticated;
create function public.recorded_business_profit(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare services jsonb;other_income jsonb;costs jsonb;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 services:=public.combined_service_profitability(p_from,p_to);
 other_income:=public.other_income_report(p_from,p_to,1);
 costs:=public.service_profitability(p_from,p_to);
 with undated as (
 select l.id as line_id,l.invoice_id,i.invoice_number,l.description from public.invoice_lines l join public.invoices i on i.id=l.invoice_id and i.status='issued'
 where not exists(select 1 from public.dated_service_revenue d where d.line_id=l.id)
  and not exists(select 1 from public.dated_feed_revenue d where d.line_id=l.id)
  and not exists(select 1 from public.dated_other_income d where d.line_id=l.id)
 ), adjustment_review as (
 select a.id as adjustment_id,a.invoice_id,i.invoice_number from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id and i.status='issued'
 left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
 where r.id is null
  or r.training_cents>0 and not exists(select 1 from public.dated_service_adjustments d where d.adjustment_id=a.id and d.service='training')
  or r.board_cents>0 and not exists(select 1 from public.dated_service_adjustments d where d.adjustment_id=a.id and d.service='board')
  or r.feed_cents>0 and not exists(select 1 from public.dated_feed_adjustments d where d.adjustment_id=a.id)
  or r.other_cents>0 and not exists(select 1 from public.dated_other_adjustments d where d.adjustment_id=a.id)
 ), cost_review as (
 select s.expense_id,s.vendor,s.eligible_cents from public.service_cost_sources s left join public.service_cost_allocations a on a.expense_id=s.expense_id and a.retired_at is null
 where s.eligible_cents>0 and (a.id is null or a.cleared or a.source_cents<>s.eligible_cents)
 ), inventory_review as (
 select s.source_kind,s.source_id,s.label,s.source_date,r.recognition_date from public.profit_inventory_sources s
 left join public.profit_inventory_reviews r on r.source_kind=s.source_kind and r.source_id=s.source_id and r.retired_at is null
 where not exists(select 1 from public.valid_profit_inventory_reviews v where v.id=r.id)
  and ((s.source_kind<>'return' and s.source_date between p_from and p_to)
   or s.source_kind='return' and (s.minimum_date<=p_to or r.recognition_date between p_from and p_to))
 ), facts as (
 select (services#>>'{totals,net_cents}')::numeric+(other_income#>>'{totals,net_cents}')::numeric as income_cents,
  (services#>>'{totals,cost_cents}')::numeric as service_cost_cents,(costs->>'other_cost_cents')::numeric as other_cost_cents,
  (select coalesce(round(sum(-m.value_delta_cents)),0) from public.inventory_movements m where m.kind='waste' and m.movement_date between p_from and p_to and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)) as waste_cost_cents,
  (select count(*) from public.inventory_movements m where m.kind='waste' and m.movement_date between p_from and p_to and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)) as waste_count,
  (select coalesce(sum(profit_cents),0) from public.valid_profit_inventory_reviews where recognition_date between p_from and p_to) as inventory_adjustment_cents,
  (services#>>'{review,needs_review}')::boolean or (other_income->>'unmatched_issued_count')::bigint>0 or (other_income->>'unresolved_adjustment_count')::bigint>0
   or exists(select 1 from undated) or exists(select 1 from adjustment_review) or exists(select 1 from cost_review) or exists(select 1 from inventory_review) as needs_review
 ), totals as (
 select *,service_cost_cents+other_cost_cents+waste_cost_cents as cost_cents,
  case when not needs_review then income_cents-service_cost_cents-other_cost_cents-waste_cost_cents+inventory_adjustment_cents end as profit_cents from facts
 ) select jsonb_build_object('totals',(select to_jsonb(t)||jsonb_build_object('margin_percent',case when not needs_review and income_cents>0 then round(profit_cents*100/income_cents,2) end) from totals t),
 'services',services,'other_income',other_income,'undated_income_count',(select count(*) from undated),
 'undated_income',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from undated order by invoice_id,line_id limit 25)x),'[]'::jsonb),
 'adjustment_review_count',(select count(*) from adjustment_review),
 'adjustment_review',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from adjustment_review order by invoice_id,adjustment_id limit 25)x),'[]'::jsonb),
 'cost_review_count',(select count(*) from cost_review),'unreviewed_cost_cents',(select coalesce(sum(eligible_cents),0) from cost_review),
 'cost_review',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from cost_review order by expense_id limit 25)x),'[]'::jsonb),
 'inventory_review_counts',(select jsonb_build_object('correction',count(*) filter(where source_kind='correction'),'return',count(*) filter(where source_kind='return'),'credit',count(*) filter(where source_kind='credit')) from inventory_review),
 'inventory_review',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from inventory_review order by source_kind,source_id limit 25)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.recorded_business_profit(date,date) from public,anon;
grant execute on function public.recorded_business_profit(date,date) to authenticated;
commit;
