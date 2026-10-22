-- Aggregate in PostgreSQL so API row limits cannot truncate financial totals.
create function public.cash_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare received bigint; spent bigint; outstanding bigint; overdue bigint; breakdown jsonb; monthly jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then
    raise exception 'Choose a valid reporting period of at most ten years';
  end if;
  select coalesce(sum(p.amount_cents),0) into received from public.invoice_payments p
    join public.invoices i on i.id=p.invoice_id
    where p.reversed_at is null and i.status='issued' and p.paid_on between p_from and p_to;
  select coalesce(sum(e.amount_cents),0) into spent from public.expenses e
    where e.voided_at is null and e.paid_on between p_from and p_to;
  select coalesce(sum(balance_cents),0),coalesce(sum(balance_cents) filter(where due_date<(now() at time zone 'America/Chicago')::date),0)
    into outstanding,overdue from public.invoice_totals where status='issued' and balance_cents>0;
  select coalesce(jsonb_agg(x order by x.amount_cents desc,x.name),'[]') into breakdown from (
    select coalesce(c.name,'Uncategorized') as name,sum(e.amount_cents) as amount_cents,count(*) as expense_count
    from public.expenses e left join public.expense_categories c on c.id=e.category_id
    where e.voided_at is null and e.paid_on between p_from and p_to group by c.id,c.name
  ) x;
  select coalesce(jsonb_agg(x order by x.month),'[]') into monthly from (
    select to_char(m,'YYYY-MM') as month,
      (select coalesce(sum(p.amount_cents),0) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id
        where p.reversed_at is null and i.status='issued' and p.paid_on between p_from and p_to and date_trunc('month',p.paid_on)=m) as received_cents,
      (select coalesce(sum(e.amount_cents),0) from public.expenses e where e.voided_at is null and e.paid_on between p_from and p_to and date_trunc('month',e.paid_on)=m) as spent_cents
    from generate_series(date_trunc('month',p_from),date_trunc('month',p_to),interval '1 month') m
  ) x;
  return jsonb_build_object('received_cents',received,'spent_cents',spent,'net_cents',received-spent,
    'outstanding_cents',outstanding,'overdue_cents',overdue,'categories',breakdown,'months',monthly);
end $$;
revoke all on function public.cash_report(date,date) from public;
grant execute on function public.cash_report(date,date) to authenticated;
