begin;
-- All components are read-only. Stable volatility gives the bundle one statement snapshot.
alter function public.feed_charge_comparison(date,date) stable;
create function public.combined_service_profitability(p_from date,p_to date) returns jsonb
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
revoke all on function public.combined_service_profitability(date,date) from public,anon;
grant execute on function public.combined_service_profitability(date,date) to authenticated;
commit;
