begin;
create function public.supplier_recovery_queue(p_filter text default 'outstanding',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; business_today date := (now() at time zone 'America/Chicago')::date;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_filter is null or p_filter not in ('outstanding','overdue','unset','all') or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid recovery filter and page';end if;
 with cash as (
 select return_id,sum(amount_cents) as received from public.supplier_refunds where reversed_at is null group by return_id
 ), credit as (
 select return_id,sum(amount_cents) as issued from public.supplier_credits where cancelled_at is null and return_id is not null group by return_id
 ), recovery as (
 select r.id,r.vendor,r.created_at,m.movement_date as returned_on,p.name as product_name,
 e.cash_cents,e.cash_due,e.credit_cents,e.credit_due,e.notes,
 coalesce(c.received,0) as cash_received_cents,coalesce(k.issued,0) as credit_issued_cents,
 case when e.cash_cents is not null then greatest(e.cash_cents-coalesce(c.received,0),0) end as cash_remaining_cents,
 case when e.credit_cents is not null then greatest(e.credit_cents-coalesce(k.issued,0),0) end as credit_remaining_cents
 from public.supplier_returns r join public.inventory_movements m on m.id=r.movement_id join public.inventory_products p on p.id=m.product_id
 left join public.supplier_return_expectations e on e.return_id=r.id left join cash c on c.return_id=r.id left join credit k on k.return_id=r.id
 where r.cancelled_at is null
 ), statuses as (
 select *,coalesce(cash_remaining_cents>0,false) or coalesce(credit_remaining_cents>0,false) as outstanding,
 (coalesce(cash_remaining_cents>0 and cash_due<business_today,false) or coalesce(credit_remaining_cents>0 and credit_due<business_today,false)) as overdue,
 cash_cents is null or credit_cents is null as unset,
 least(case when cash_remaining_cents>0 then cash_due end,case when credit_remaining_cents>0 then credit_due end) as next_due
 from recovery
 ), filtered as (
 select * from statuses where p_filter='all' or (p_filter='outstanding' and outstanding) or (p_filter='overdue' and overdue) or (p_filter='unset' and unset)
 ), page as (
 select * from filtered order by overdue desc,next_due asc nulls last,created_at desc,id limit 25 offset (p_page-1)*25
 ) select jsonb_build_object('as_of',business_today,'total',(select count(*) from filtered),
 'summary',(select jsonb_build_object('cash_remaining_cents',coalesce(sum(cash_remaining_cents),0),'credit_remaining_cents',coalesce(sum(credit_remaining_cents),0),
 'outstanding_count',count(*) filter(where outstanding),'overdue_count',count(*) filter(where overdue),'unset_count',count(*) filter(where unset),'active_count',count(*)) from statuses),
 'rows',coalesce((select jsonb_agg(page order by overdue desc,next_due asc nulls last,created_at desc,id) from page),'[]')) into result;
 return result;
end;$$;
revoke all on function public.supplier_recovery_queue(text,integer) from public,anon;
grant execute on function public.supplier_recovery_queue(text,integer) to authenticated;
commit;
