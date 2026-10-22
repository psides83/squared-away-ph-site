create function public.expense_followup(p_expenses uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_expenses is null or cardinality(p_expenses)>100 or array_position(p_expenses,null) is not null then raise exception 'Choose at most 100 expenses'; end if;
 with linked_lines as (
  select c.expense_id,l.id,l.invoice_id,e.amount_cents::bigint as cost_cents,l.amount_cents::bigint as charge_cents
  from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id join public.expenses e on e.id=c.expense_id where c.expense_id=any(p_expenses)
  union all
  select c.expense_id,l.id,l.invoice_id,coalesce((l.source_snapshot->>'original_cost_cents')::bigint,l.amount_cents::bigint),l.amount_cents::bigint
  from public.invoice_boarding_claims c join public.invoice_lines l on l.id=c.line_id where c.expense_id=any(p_expenses)
 ), on_invoice as (
  select l.expense_id,i.id,i.invoice_number,i.status,i.customer_id,i.due_date,i.balance_cents,i.total_cents,
    sum(l.cost_cents) cost_cents,sum(l.charge_cents) charge_cents
  from linked_lines l join public.invoice_totals i on i.id=l.invoice_id where i.status in ('draft','issued')
  group by l.expense_id,i.id,i.invoice_number,i.status,i.customer_id,i.due_date,i.balance_cents,i.total_cents
 ) select coalesce(jsonb_agg(jsonb_build_object('expense_id',e.id,
   'receipt_count',(select count(*) from public.expense_receipts r where r.expense_id=e.id),
   'draft_cost_cents',coalesce((select sum(x.cost_cents) from on_invoice x where x.expense_id=e.id and x.status='draft'),0),
   'issued_cost_cents',coalesce((select sum(x.cost_cents) from on_invoice x where x.expense_id=e.id and x.status='issued'),0),
   'invoices',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('customer_name',c.name) order by x.due_date,x.id) from on_invoice x join public.customers c on c.id=x.customer_id where x.expense_id=e.id),'[]'::jsonb)) order by e.id),'[]'::jsonb) into result
 from public.expenses e where e.id=any(p_expenses);
 return result;
end; $$;
revoke all on function public.expense_followup(uuid[]) from public,anon;
grant execute on function public.expense_followup(uuid[]) to authenticated;
