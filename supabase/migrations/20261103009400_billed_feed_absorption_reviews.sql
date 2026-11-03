begin;
alter table public.feed_absorptions add column invoice_review_ack boolean not null default false;
create table public.feed_absorption_invoice_reviews (
 decision_id uuid not null references public.feed_absorptions(id),invoice_id uuid not null references public.invoices(id),line_id uuid not null,movement_id uuid not null references public.inventory_movements(id),
 previous_cents numeric(24,6) not null,new_cents numeric(24,6) not null,captured_source jsonb not null,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 resolved_at timestamptz,resolved_by uuid references auth.users(id),resolution text,primary key(decision_id,invoice_id)
);
alter table public.feed_absorption_invoice_reviews enable row level security;
revoke all on public.feed_absorption_invoice_reviews from public,anon,authenticated;
grant select on public.feed_absorption_invoice_reviews to authenticated;
create policy admin_read on public.feed_absorption_invoice_reviews for select to authenticated using((select public.is_admin()));
create function public.feed_absorption_invoice_token(p_invoice uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(i.id,i.status,
 (select jsonb_agg(jsonb_build_array(l.id,l.amount_cents,l.source_snapshot) order by l.id) from public.invoice_lines l where l.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(a.id,a.amount_cents) order by a.id) from public.invoice_adjustments a where a.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(p.id,p.amount_cents,p.paid_on,p.reversed_at) order by p.id) from public.invoice_payments p where p.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(r.id,r.amount_cents,r.refunded_on,r.reversed_at) order by r.id) from public.invoice_refunds r where r.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(c.id,c.amount_cents,c.credit_on,c.reversed_at) order by c.id) from public.customer_credits c join public.invoice_payments p on p.id=c.payment_id where p.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(r.id,r.amount_cents,r.refunded_on,r.reversed_at) order by r.id) from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id join public.invoice_payments p on p.id=c.payment_id where p.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(a.id,a.amount_cents,a.applied_on,a.reversed_at) order by a.id) from public.customer_credit_applications a where a.invoice_id=i.id),

 (select jsonb_agg(jsonb_build_array(r.decision_id,r.movement_id,m.value_delta_cents,m.movement_date,m.horse_id,m.product_id,m.kind,m.quantity_delta_oz,exists(select 1 from public.inventory_movements rev where rev.reverses_id=m.id),a.id,a.source_token,a.amount_cents,a.mode) order by r.decision_id) from public.feed_absorption_invoice_reviews r join public.inventory_movements m on m.id=r.movement_id left join public.feed_absorptions a on a.movement_id=m.id and a.retired_at is null where r.invoice_id=i.id and r.resolved_at is null))::text)
 from public.invoices i where i.id=p_invoice
$$;
revoke all on function public.feed_absorption_invoice_token(uuid) from public,anon,authenticated;
-- A draft must reflect both current source cost and its reviewed protected portion.
create or replace function public.resolve_feed_cost_flag(p_correction uuid,p_invoice uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare i public.invoices;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Describe your review and any billing adjustment';end if;
 select * into i from public.invoices where id=p_invoice for update;
 if not found then raise exception 'Invoice not found';end if;
 if i.status='draft' and exists(select 1 from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id where l.invoice_id=i.id and public.feed_absorption_pending(c.movement_id)) then raise exception 'Review changed absorbed feed decisions and regenerate outdated draft sources before completing this cost review';end if;
 if i.status='draft' and exists(
  select 1 from public.invoice_lines l cross join lateral jsonb_array_elements(coalesce(l.source_snapshot->'sources','[]')) src
  join public.inventory_movements m on m.id=(src->>'movement_id')::uuid
  where l.invoice_id=i.id and l.source_snapshot->>'basis'='consumption' and l.source_snapshot->>'service'='feed'
  and ((src->>'cost_cents')::numeric is distinct from public.feed_invoice_weight(l.id,m.id,-m.value_delta_cents)
   or (case when jsonb_typeof(src->'absorbed_cost_cents')='number' then (src->>'absorbed_cost_cents')::numeric else 0 end)<>public.feed_absorbed(m.id))
 ) then raise exception 'Remove and regenerate outdated actual-cost feed lines before completing this review';end if;
 update public.invoice_feed_cost_flags set resolved_at=now(),resolved_by=auth.uid(),resolution=trim(p_reason) where correction_id=p_correction and invoice_id=p_invoice and resolved_at is null;
end;$$;
create function public.invoice_feed_absorption_reviews(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select jsonb_build_object('invoice_id',p_invoice,'status',i.status,'source_token',public.feed_absorption_invoice_token(i.id),'pending_count',(select count(*) from public.feed_absorption_invoice_reviews r where r.invoice_id=i.id and r.resolved_at is null),
 'rows',coalesce((select jsonb_agg(to_jsonb(x)-'created_by'-'resolved_by' order by created_at desc,decision_id) from(select * from public.feed_absorption_invoice_reviews r where r.invoice_id=i.id and r.resolved_at is null order by created_at desc,decision_id)x),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(x)-'created_by'-'resolved_by' order by resolved_at desc,decision_id) from(select * from public.feed_absorption_invoice_reviews r where r.invoice_id=i.id and r.resolved_at is not null order by resolved_at desc,decision_id limit 10)x),'[]'::jsonb)) into result from public.invoices i where id=p_invoice;return result;
end;$$;
revoke all on function public.invoice_feed_absorption_reviews(uuid) from public,anon;
grant execute on function public.invoice_feed_absorption_reviews(uuid) to authenticated;
create function public.resolve_feed_absorption_invoice(p_invoice uuid,p_token text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare i public.invoices;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_token is null or length(p_token)<>32 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Review the current invoice and enter your manual billing resolution';end if;
 select * into i from public.invoices where id=p_invoice for update;
 if not found or i.status not in ('draft','issued') then raise exception 'Choose a non-voided invoice';end if;
 if not exists(select 1 from public.feed_absorption_invoice_reviews where invoice_id=p_invoice and resolved_at is null) then return;end if;
 if p_token is distinct from public.feed_absorption_invoice_token(p_invoice) then raise exception 'Invoice activity or feed decisions changed. Close and reopen the review';end if;
 if exists(select 1 from public.feed_absorption_invoice_reviews r where r.invoice_id=i.id and r.resolved_at is null and public.feed_absorption_pending(r.movement_id) and not exists(select 1 from public.inventory_movements rev where rev.reverses_id=r.movement_id)) then raise exception 'Review the latest corrected feeding costs before resolving invoice follow-up';end if;
 if i.status='draft' and exists(
 select 1 from public.invoice_lines l cross join lateral jsonb_array_elements(coalesce(l.source_snapshot->'sources','[]')) src join public.inventory_movements m on m.id=(src->>'movement_id')::uuid
 where l.invoice_id=i.id and l.source_snapshot->>'basis'='consumption'
 and ((src->>'cost_cents')::numeric is distinct from public.feed_invoice_weight(l.id,m.id,-m.value_delta_cents)
 or (case when jsonb_typeof(src->'absorbed_cost_cents')='number' then (src->>'absorbed_cost_cents')::numeric else 0 end)<>public.feed_absorbed(m.id))) then raise exception 'Remove and regenerate outdated draft feed charges before resolving this review';end if;
 update public.feed_absorption_invoice_reviews set resolved_at=now(),resolved_by=auth.uid(),resolution=trim(p_reason) where invoice_id=i.id and resolved_at is null;
end;$$;
revoke all on function public.resolve_feed_absorption_invoice(uuid,text,text) from public,anon;
grant execute on function public.resolve_feed_absorption_invoice(uuid,text,text) to authenticated;
create function public.guard_feed_absorption_invoice_review() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status='issued' and old.status='draft' and exists(select 1 from public.feed_absorption_invoice_reviews r where r.invoice_id=new.id and r.resolved_at is null) then raise exception 'Review absorbed-feed billing changes before finalizing this invoice';end if;return new;end;$$;
revoke all on function public.guard_feed_absorption_invoice_review() from public,anon,authenticated;
create trigger feed_absorption_billing_review before update on public.invoices for each row execute function public.guard_feed_absorption_invoice_review();

create function public.close_voided_feed_absorption_reviews() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status='void' and old.status<>'void' then update public.feed_absorption_invoice_reviews set resolved_at=now(),resolved_by=auth.uid(),resolution='Invoice voided; its charges are inactive.' where invoice_id=new.id and resolved_at is null;end if;return new;end;$$;
revoke all on function public.close_voided_feed_absorption_reviews() from public,anon,authenticated;
create trigger close_voided_feed_absorption_reviews after update on public.invoices for each row execute function public.close_voided_feed_absorption_reviews();

drop function public.set_feed_absorption(uuid,uuid,uuid,text,text,integer,text);
create function public.set_feed_absorption(p_request uuid,p_movement uuid,p_current uuid,p_token text,p_mode text,p_cents integer,p_reason text,p_invoice_review boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.feed_absorptions;cur public.feed_absorptions;s public.feed_absorption_sources;product uuid;amount numeric;claimed boolean;claimed_invoice uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_invoice_review is null or p_request is null or p_movement is null or p_token is null or length(p_token)<>32 or p_mode is null or p_mode not in ('full','partial','review','clear') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or (p_mode='partial' and (p_cents is null or p_cents not between 1 and 100000000)) or (p_mode<>'partial' and p_cents is not null) then raise exception 'Choose a current feeding, fixed amount or full cost, and a private reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.feed_absorptions where id=p_request;
 if found then
  if row(old.movement_id,old.previous_id,old.source_token,old.mode,old.requested_cents,old.reason,old.invoice_review_ack) is distinct from row(p_movement,p_current,p_token,p_mode,p_cents,trim(p_reason),p_invoice_review) then raise exception 'This request was already used with different values';end if;return old.id;
 end if;
 select l.invoice_id into claimed_invoice from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id where c.movement_id=p_movement;
 if claimed_invoice is not null then perform 1 from public.invoices where id=claimed_invoice for update;end if;
 select product_id into product from public.inventory_movements where id=p_movement;
 perform 1 from public.horses where id=(select horse_id from public.inventory_movements where id=p_movement) for update;
 perform 1 from public.inventory_products where id=product for update;
 select * into cur from public.feed_absorptions where movement_id=p_movement and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The absorbed amount changed. Close and reopen this editor';end if;
 select * into s from public.feed_absorption_sources where movement_id=p_movement;
 if not found then raise exception 'Choose an unreversed feeding assigned to a horse';end if;
 claimed:=exists(select 1 from public.invoice_feed_claims where movement_id=p_movement);
 if claimed and claimed_invoice is null then raise exception 'This feeding was invoiced concurrently. Close and reopen the editor';end if;
 if p_mode='clear' then
  if cur.id is null or cur.mode='clear' or p_token<>cur.source_token or (claimed and not p_invoice_review) then raise exception 'Only an unbilled saved designation can be cleared';end if;amount:=0;
 else
  if s.source_token<>p_token then raise exception 'The recorded feeding cost changed. Close and reopen this editor';end if;
  if claimed and not p_invoice_review and (p_mode<>'review' or cur.id is null or cur.mode='clear') then raise exception 'Already-billed feed uses its saved invoice decision. Only the same fixed absorbed amount can be reviewed';end if;
  if p_mode='review' then
   if cur.id is null or cur.mode='clear' then raise exception 'Choose an existing fixed absorbed amount to review';end if;amount:=cur.amount_cents;
  elsif p_mode='full' then amount:=s.cost_cents;
  else amount:=p_cents;end if;
  if amount>s.cost_cents then raise exception 'The absorbed amount exceeds the current recorded cost. Resolve the invoice if billed, or revise the unbilled designation';end if;
 end if;
 update public.feed_absorptions set retired_at=now() where id=cur.id;
 insert into public.feed_absorptions(id,movement_id,previous_id,source_token,captured_source,mode,requested_cents,amount_cents,reason,created_by,invoice_review_ack)
 values(p_request,p_movement,p_current,case when p_mode='clear' then cur.source_token else p_token end,case when p_mode='clear' then cur.captured_source else s.captured_source end,p_mode,p_cents,amount,trim(p_reason),auth.uid(),p_invoice_review);
 if claimed and amount is distinct from (case when cur.id is not null and cur.mode<>'clear' then cur.amount_cents else 0 end) then
  insert into public.feed_absorption_invoice_reviews(decision_id,invoice_id,line_id,movement_id,previous_cents,new_cents,captured_source,created_by)
  select p_request,l.invoice_id,l.id,p_movement,case when cur.id is not null and cur.mode<>'clear' then cur.amount_cents else 0 end,amount,
   jsonb_build_object('feeding',s.captured_source,'invoice_amount_cents',l.amount_cents,'invoice_source',l.source_snapshot,'reason',trim(p_reason)),auth.uid()
  from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id where c.movement_id=p_movement;
 end if;
 return p_request;
end;$$;
revoke all on function public.set_feed_absorption(uuid,uuid,uuid,text,text,integer,text,boolean) from public,anon;
grant execute on function public.set_feed_absorption(uuid,uuid,uuid,text,text,integer,text,boolean) to authenticated;
create or replace function public.feed_absorption_report(p_from date,p_to date,p_horse uuid default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose valid dates and page';end if;
 with rows as (
 select s.*,exists(select 1 from public.invoice_feed_claims c where c.movement_id=s.movement_id) as claimed,coalesce((select l.invoice_id from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id where c.movement_id=s.movement_id limit 1),(select r.invoice_id from public.feed_absorption_invoice_reviews r where r.movement_id=s.movement_id and r.resolved_at is null order by r.created_at desc,r.decision_id limit 1)) as claim_invoice_id,
 (select count(*) from public.feed_absorption_invoice_reviews r where r.movement_id=s.movement_id and r.resolved_at is null) as invoice_review_count,coalesce((select jsonb_agg(distinct r.invoice_id) from public.feed_absorption_invoice_reviews r where r.movement_id=s.movement_id and r.resolved_at is null),'[]'::jsonb) as pending_invoice_ids,
 public.feed_absorption_pending(s.movement_id) as needs_review,public.feed_absorbed(s.movement_id) as absorbed_cents,
 case when a.id is null then null else to_jsonb(a)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.feed_absorptions where movement_id=s.movement_id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.feed_absorption_sources s left join public.feed_absorptions a on a.movement_id=s.movement_id and a.retired_at is null
 where s.movement_date between p_from and p_to and (p_horse is null or s.horse_id=p_horse)
 ) select jsonb_build_object('count',(select count(*) from rows),'totals',(select jsonb_build_object('cost_cents',coalesce(round(sum(cost_cents)),0),'absorbed_cents',coalesce(round(sum(absorbed_cents)),0),'review_count',count(*) filter(where needs_review),'invoice_review_count',coalesce(sum(invoice_review_count),0),'supported_unbilled_cents',coalesce(round(sum(cost_cents-absorbed_cents) filter(where not claimed and not needs_review and exists(select 1 from public.training_stays stay where stay.horse_id=r.horse_id and stay.feed_billing='at_cost' and r.movement_date>=stay.arrival_date and (stay.departure_date is null or r.movement_date<=stay.departure_date) and not exists(select 1 from public.invoice_service_days d where d.stay_id=stay.id and d.service='feed' and d.day=r.movement_date)))),0)) from rows r),
 'rows',coalesce((select jsonb_agg(to_jsonb(x) order by movement_date desc,movement_id) from(select * from rows order by movement_date desc,movement_id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;return result;
end;$$;
create or replace function public.combined_service_profitability(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare service_report jsonb;feed_report jsonb;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose valid dates covering at most ten years';end if;
 service_report:=public.service_profitability(p_from,p_to);
 feed_report:=public.feed_charge_comparison(p_from,p_to);
 with services as (
  select x->>'service' as service,(x->>'gross_cents')::numeric as gross_cents,(x->>'adjustment_cents')::numeric as adjustment_cents,
   (x->>'draft_cents')::numeric as draft_cents,(x->>'cost_cents')::numeric as cost_cents
  from jsonb_array_elements(service_report->'services') x
  union all
  select 'feed',(feed_report#>>'{totals,issued_cents}')::numeric-(feed_report#>>'{totals,adjustment_cents}')::numeric,
   (feed_report#>>'{totals,adjustment_cents}')::numeric,(feed_report#>>'{totals,draft_cents}')::numeric,
   (feed_report#>>'{totals,cost_cents}')::numeric+(feed_report->>'unassigned_cost_cents')::numeric
 ), feed_reviews as (
  select h->>'horse_id' as horse_id from jsonb_array_elements(feed_report->'horses') h
  where (h->>'included')::boolean or (h->>'has_unmatched')::boolean or (h->>'has_adjustments')::boolean
   or (h->>'feeding_lines')::bigint=0 and (h->>'issued_cents')::numeric<>0
 ), unsupported_feed as (
  -- Include unassigned invoices and complete histories, not just the 25 review-detail samples.
  select l.id from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  where i.status='issued' and l.billing_category='feed'
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
    or exists(select 1 from public.manual_feed_periods m where m.line_id=l.id and m.retired_at is null and m.covered_from<=p_to and m.covered_to>=p_from))
   and not exists(select 1 from public.dated_feed_revenue d where d.line_id=l.id)
 ), correction_reviews as (
  select distinct f.invoice_id from public.invoice_feed_cost_flags f join public.invoices i on i.id=f.invoice_id
  where f.resolved_at is null and i.status='issued'
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
    or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 union
 select distinct f.invoice_id from public.feed_absorption_invoice_reviews f join public.invoices i on i.id=f.invoice_id
 where f.resolved_at is null and i.status='issued' and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
 or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 ), unassigned_adjustments as (
  select distinct a.id from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id
  left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  where i.status='issued' and (r.id is null or r.feed_cents>0 and not exists(select 1 from public.dated_feed_adjustments d where d.adjustment_id=a.id))
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
    or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 ), checks as (
  select (service_report->>'unallocated_cost_count')::bigint as unallocated_cost_count,
   (service_report->>'unsupported_revenue_count')::bigint as unsupported_revenue_count,
   (service_report->>'unresolved_adjustment_count')::bigint as unresolved_adjustment_count,
   (service_report->>'invalid_assignment_count')::bigint as invalid_assignment_count,
   (select count(*) from feed_reviews) as feed_horse_review_count,
   (select count(*) from unsupported_feed) as unsupported_feed_count,
   (select count(*) from correction_reviews) as feed_correction_count,
   (select count(*) from unassigned_adjustments) as feed_adjustment_count
 ), summary as (
  select sum(gross_cents) as gross_cents,sum(adjustment_cents) as adjustment_cents,sum(gross_cents+adjustment_cents) as net_cents,
   sum(draft_cents) as draft_cents,sum(cost_cents) as cost_cents from services
 ), blocked as (
  select c.*,unallocated_cost_count+unsupported_revenue_count+unresolved_adjustment_count+invalid_assignment_count+feed_horse_review_count+unsupported_feed_count+feed_correction_count+feed_adjustment_count>0 as needs_review from checks c
 ) select jsonb_build_object('services',(select jsonb_agg(to_jsonb(s) order by service) from services s),
  'totals',(select to_jsonb(s)||jsonb_build_object('difference_cents',case when not b.needs_review then s.net_cents-s.cost_cents end,
    'margin_percent',case when not b.needs_review and s.net_cents>0 then round((s.net_cents-s.cost_cents)*100/s.net_cents,2) end) from summary s cross join blocked b),
  'review',(select to_jsonb(b) from blocked b),
  'other_cost_cents',service_report->'other_cost_cents','unallocated_cost_cents',service_report->'unallocated_cost_cents',
  'unassigned_feed_cost_cents',feed_report->'unassigned_cost_cents') into result;
 return result;
end;$$;
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
   round(coalesce(sum(cost_cents-public.feed_absorbed(feeding.id)) filter(where not public.feed_absorption_pending(feeding.id) and exists(select 1 from public.training_stays s where s.horse_id=feeding.horse_id and s.feed_billing='at_cost' and feeding.movement_date>=s.arrival_date and (s.departure_date is null or feeding.movement_date<=s.departure_date))
    and not exists(select 1 from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id where c.movement_id=feeding.id and i.status in ('draft','issued'))),0)) as unbilled_actual_cents
  ,round(sum(public.feed_absorbed(feeding.id))) as absorbed_cents,count(*) filter(where public.feed_absorption_pending(feeding.id)) as absorption_review_count
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
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from) or exists(select 1 from public.manual_feed_periods a where a.line_id=l.id and a.retired_at is null and a.covered_from<=p_to and a.covered_to>=p_from) or exists(select 1 from public.monthly_service_periods a where a.line_id=l.id and a.retired_at is null and not a.cleared and a.covered_from<=p_to and a.covered_to>=p_from))
   and not exists(select 1 from public.dated_feed_revenue d where d.line_id=l.id)
 union all
  select q.horse_id,q.line_id,q.invoice_id,q.invoice_number,q.status,q.description,q.feed_cents,q.issue_date,'Review manual package dates, classifications and split' from public.manual_package_review_queue q
  where q.covered_from<=p_to and q.covered_to>=p_from
 ), horse_ids as (
  select horse_id from horse_cost union select horse_id from horse_charges union select horse_id from agreements union select horse_id from unmatched
 ), rows as (
  select h.id as horse_id,h.barn_name as name,coalesce(c.cost_cents,0) as cost_cents,coalesce(c.feeding_lines,0) as feeding_lines,
   coalesce(c.feeding_days,0) as feeding_days,coalesce(c.unbilled_actual_cents,0) as unbilled_actual_cents,(select count(*) from public.feed_absorption_invoice_reviews r join public.inventory_movements m on m.id=r.movement_id join public.invoices i on i.id=r.invoice_id where r.resolved_at is null and i.status='issued' and m.horse_id=h.id and m.movement_date between p_from and p_to) as billing_review_count,coalesce(c.absorbed_cents,0) as absorbed_cents,coalesce(c.absorption_review_count,0) as absorption_review_count,
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
   (exists(select 1 from unmatched u where u.horse_id=h.id and u.status='issued') or exists(select 1 from public.feed_absorption_invoice_reviews r join public.inventory_movements m on m.id=r.movement_id join public.invoices i on i.id=r.invoice_id where r.resolved_at is null and i.status='issued' and m.horse_id=h.id and m.movement_date between p_from and p_to)) as has_unmatched,
   coalesce(a.entries,'[]'::jsonb) as agreements,coalesce(ig.entries,'[]'::jsonb) as invoices
  from horse_ids ids join public.horses h on h.id=ids.horse_id
  left join horse_cost c on c.horse_id=h.id left join horse_charges ch on ch.horse_id=h.id
  left join agreements a on a.horse_id=h.id left join invoice_groups ig on ig.horse_id=h.id
 ) select jsonb_build_object('horses',coalesce((select jsonb_agg(to_jsonb(r) order by name,horse_id) from rows r),'[]'::jsonb),
  'totals',(select jsonb_build_object('cost_cents',coalesce(sum(cost_cents),0),'issued_cents',coalesce(sum(issued_cents),0),'draft_cents',coalesce(sum(draft_cents),0),'package_cents',coalesce(sum(package_cents),0),'adjustment_cents',coalesce(sum(adjustment_cents),0),'unbilled_actual_cents',coalesce(sum(unbilled_actual_cents),0),'billing_review_count',coalesce(sum(billing_review_count),0),'absorbed_cents',coalesce(sum(absorbed_cents),0),'absorption_review_count',coalesce(sum(absorption_review_count),0)) from rows),
  'unmatched_count',(select count(*) from unmatched),'unmatched_issued_cents',(select coalesce(sum(amount_cents) filter(where status='issued'),0) from unmatched),
  'unmatched',coalesce((select jsonb_agg(to_jsonb(u)) from (select * from unmatched order by issue_date,invoice_id,line_id limit 25) u),'[]'::jsonb),
  'unassigned_cost_cents',(select coalesce(round(sum(cost_cents)),0) from feeding where horse_id is null)) into result;
 return result;
end; $$;
revoke all on function public.feed_charge_comparison(date,date) from public,anon;
grant execute on function public.feed_charge_comparison(date,date) to authenticated;



create or replace function public.stay_feed_margins(p_from date,p_to date,p_page integer default 1) returns jsonb
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
  from invoice_context i where exists(select 1 from public.invoice_feed_cost_flags f where f.invoice_id=i.id and f.resolved_at is null) or exists(select 1 from public.feed_absorption_invoice_reviews f where f.invoice_id=i.id and f.resolved_at is null)
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from)
    or exists(select 1 from public.dated_feed_revenue d where d.invoice_id=i.id and d.service_date between p_from and p_to))
 union
  select q.invoice_id,q.invoice_number,q.horse_id,q.stay_id,'Manual package needs source-date or split review' from public.manual_package_review_queue q where q.status='issued' and q.covered_from<=p_to and q.covered_to>=p_from
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
    where i.stay_id=s.id and i.status in ('draft','issued') and (p.feed_cents>0 or p.feed_included is not null) and d.day between p_from and p_to) and not exists(select 1 from public.valid_manual_service_periods mp where mp.stay_id=s.id and mp.package_reviewed and mp.covered_from<=p_to and mp.covered_to>=p_from) as package_review
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

commit;
