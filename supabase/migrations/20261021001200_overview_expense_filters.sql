begin;
create function public.search_expenses(p_from date default null,p_to date default null,p_horse uuid default null,p_shared boolean default false,p_category uuid default null,p_status text default 'all',p_query text default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from>p_to or p_status is null or p_status not in ('all','paid','unpaid','voided') or p_page is null or p_page not between 1 and 10000 or length(p_query)>200 or (p_horse is not null and p_shared) then raise exception 'Choose valid expense filters'; end if;
  with matches as (
    select e.* from public.expenses e where (p_from is null or e.expense_date>=p_from) and (p_to is null or e.expense_date<=p_to)
      and (p_horse is null or e.horse_id=p_horse) and (not coalesce(p_shared,false) or e.horse_id is null)
      and (p_category is null or e.category_id=p_category)
      and (p_status='all' or (p_status='voided' and e.voided_at is not null) or (p_status='paid' and e.voided_at is null and e.paid_on is not null) or (p_status='unpaid' and e.voided_at is null and e.paid_on is null))
      and (nullif(trim(p_query),'') is null or position(lower(trim(p_query)) in lower(coalesce(e.vendor,'')||' '||coalesce(e.notes,'')))>0)
  ), page as (
    select m.*,(select coalesce(jsonb_agg(jsonb_build_object('id',v.id)),'[]') from public.inventory_movements v where v.expense_id=m.id) as inventory_movements
    from matches m order by expense_date desc,created_at desc,id limit 25 offset (p_page-1)*25
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by expense_date desc,created_at desc,id) from page),'[]'),'total',(select count(*) from matches)) into result;
  return result;
end $$;
create function public.admin_financial_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_day date:=(now() at time zone 'America/Chicago')::date; cash jsonb; recent jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  cash:=public.cash_report(date_trunc('month',current_day)::date,current_day);
  with records as (
    select i.id,'invoice'::text as kind,coalesce(i.voided_at,i.issued_at,i.created_at) as event_at,
      case i.status when 'void' then 'Invoice voided' when 'issued' then 'Invoice finalized' else 'Draft invoice created' end as label,
      coalesce(i.customer_snapshot->>'name',c.name) as detail,'/admin/invoices/'||i.id::text as href
      from public.invoices i join public.customers c on c.id=i.customer_id
    union all
    select p.id,'payment',coalesce(p.reversed_at,p.created_at),case when p.reversed_at is null then 'Payment recorded' else 'Payment reversed' end,
      coalesce(i.customer_snapshot->>'name',c.name),'/admin/invoices/'||i.id::text
      from public.invoice_payments p join public.invoices i on i.id=p.invoice_id join public.customers c on c.id=i.customer_id
    union all
    select e.id,'expense',coalesce(e.voided_at,e.updated_at),case when e.voided_at is not null then 'Expense voided' when e.updated_at>e.created_at then 'Expense updated' else 'Expense recorded' end,
      coalesce(e.vendor,'Barn expense'),'/admin/expenses?edit='||e.id::text from public.expenses e
    union all
    select t.id,'training',t.updated_at,case t.kind when 'session' then 'Training session recorded' else 'Training note recorded' end,
      h.barn_name||' · '||t.title,'/admin/log?edit='||t.id::text from public.training_entries t join public.horses h on h.id=t.horse_id
  ), latest as (select * from records order by event_at desc,kind,id limit 8)
  select coalesce(jsonb_agg(latest order by event_at desc,kind,id),'[]') into recent from latest;
  return jsonb_build_object('as_of',current_day,'month_from',date_trunc('month',current_day)::date,
    'received_cents',cash->'received_cents','spent_cents',cash->'spent_cents','net_cents',cash->'net_cents',
    'outstanding_cents',cash->'outstanding_cents','overdue_cents',cash->'overdue_cents',
    'outstanding_count',(select count(*) from public.invoice_totals where status='issued' and balance_cents>0),
    'overdue_count',(select count(*) from public.invoice_totals where status='issued' and balance_cents>0 and due_date<current_day),'recent',recent);
end $$;
revoke all on function public.search_expenses(date,date,uuid,boolean,uuid,text,text,integer),public.admin_financial_overview() from public;
grant execute on function public.search_expenses(date,date,uuid,boolean,uuid,text,text,integer),public.admin_financial_overview() to authenticated;
commit;
