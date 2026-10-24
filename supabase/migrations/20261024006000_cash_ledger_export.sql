begin;
create function public.cash_ledger_export(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid reporting period of at most ten years';end if;
 with activity as (
  select p.paid_on as cash_date,'payment'::text as kind,p.id as source_id,p.invoice_id as related_id,
   coalesce(i.customer_snapshot->>'name',c.name) as party,null::text as category,i.invoice_number::text as invoice_number,
   p.method,p.reference,p.amount_cents::bigint as cash_in_cents,0::bigint as cash_out_cents,0::bigint as gross_expense_cents,0::bigint as credit_cents
  from public.invoice_payments p join public.invoices i on i.id=p.invoice_id join public.customers c on c.id=i.customer_id
  where p.reversed_at is null and i.status='issued' and p.paid_on between p_from and p_to
  union all
  select e.paid_on,'expense',e.id,null::uuid,e.vendor,c.name,null::text,null::text,null::text,
   0::bigint,e.amount_cents-public.supplier_credit_used(e.id),e.amount_cents::bigint,public.supplier_credit_used(e.id)
  from public.expenses e left join public.expense_categories c on c.id=e.category_id
  where e.voided_at is null and e.paid_on between p_from and p_to
  union all
  select r.paid_on,'supplier_refund',r.id,r.return_id,t.vendor,null::text,null::text,null::text,r.reference,
   r.amount_cents::bigint,0::bigint,0::bigint,0::bigint
  from public.supplier_refunds r join public.supplier_returns t on t.id=r.return_id
  where r.reversed_at is null and r.paid_on between p_from and p_to
  union all
  select r.refunded_on,'customer_refund',r.id,r.invoice_id,coalesce(i.customer_snapshot->>'name',c.name),null::text,i.invoice_number::text,r.method,r.reference,
   0::bigint,r.amount_cents::bigint,0::bigint,0::bigint
  from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id join public.customers c on c.id=i.customer_id
  where r.reversed_at is null and r.refunded_on between p_from and p_to
 ), bounded as (
  select * from activity order by cash_date,kind,source_id limit 10001
 ) select jsonb_build_object('from',p_from,'to',p_to,'currency','USD','generated_at',statement_timestamp(),'row_count',count(*),
  'rows',coalesce(jsonb_agg(to_jsonb(b) order by cash_date,kind,source_id),'[]'::jsonb),
  'totals',jsonb_build_object(
   'received_cents',coalesce(sum(cash_in_cents) filter(where kind='payment'),0),
   'spent_cents',coalesce(sum(cash_out_cents) filter(where kind='expense'),0),
   'supplier_refunds_cents',coalesce(sum(cash_in_cents) filter(where kind='supplier_refund'),0),
   'customer_refunds_cents',coalesce(sum(cash_out_cents) filter(where kind='customer_refund'),0),
   'supplier_credit_used_cents',coalesce(sum(credit_cents),0),
   'net_cents',coalesce(sum(cash_in_cents-cash_out_cents),0)
  )) into result from bounded b;
 if (result->>'row_count')::integer>10000 then raise exception 'This export exceeds 10,000 entries. Choose a shorter reporting period';end if;
 return result;
end;$$;
revoke all on function public.cash_ledger_export(date,date) from public,anon;
grant execute on function public.cash_ledger_export(date,date) to authenticated;
commit;
