begin;
create table public.supplier_returns (
 id uuid primary key,movement_id uuid not null unique references public.inventory_movements(id),
 vendor text not null check(length(trim(vendor)) between 1 and 200),reason text not null check(length(trim(reason)) between 1 and 2000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancel_reason text
);
create table public.supplier_refunds (
 id uuid primary key,return_id uuid not null references public.supplier_returns(id),amount_cents integer not null check(amount_cents between 1 and 100000000),
 paid_on date not null,reference text,notes text,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 reversed_at timestamptz,reversed_by uuid references auth.users(id),reverse_reason text
);
create index supplier_refund_cash on public.supplier_refunds(paid_on) where reversed_at is null;
create index supplier_refund_return on public.supplier_refunds(return_id);
do $$declare t text;begin foreach t in array array['supplier_returns','supplier_refunds'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using(public.is_admin())',t);
end loop;end $$;
create function public.record_supplier_return(p_request uuid,p_product uuid,p_unit uuid,p_quantity numeric,p_date date,p_vendor text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.supplier_returns;m public.inventory_movements;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_vendor is null or length(trim(p_vendor)) not between 1 and 200 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter the supplier and return reason';end if;
 perform 1 from public.inventory_products where id=p_product for update;
 select * into previous from public.supplier_returns where id=p_request;
 if found then
  select * into m from public.inventory_movements where id=previous.movement_id;
  if row(m.product_id,m.unit_id,m.entered_quantity,m.movement_date,previous.vendor,previous.reason) is distinct from row(p_product,p_unit,p_quantity,p_date,trim(p_vendor),trim(p_reason)) then raise exception 'This return form was already used. Reload';end if;
  return previous.id;
 end if;
 result:=public.record_stock_movement(p_request,p_product,p_unit,p_quantity,'adjustment_out',p_date,null,null,'Supplier return: '||trim(p_reason));
 insert into public.supplier_returns(id,movement_id,vendor,reason,created_by)
 values(p_request,(result->>'movement_id')::uuid,trim(p_vendor),trim(p_reason),auth.uid());
 return p_request;
end;$$;
create function public.record_supplier_refund(p_request uuid,p_return uuid,p_amount integer,p_date date,p_reference text default null,p_notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.supplier_refunds;r public.supplier_returns;returned_on date;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_return is null or p_amount is null or p_amount not between 1 and 100000000 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or coalesce(length(p_reference),0)>200 or coalesce(length(p_notes),0)>2000 then raise exception 'Enter an actual refund amount and received date';end if;
 select * into r from public.supplier_returns where id=p_return for update;
 if not found then raise exception 'Return not found';end if;
 select * into previous from public.supplier_refunds where id=p_request;
 if found then
  if row(previous.return_id,previous.amount_cents,previous.paid_on,previous.reference,previous.notes) is distinct from row(p_return,p_amount,p_date,nullif(trim(p_reference),''),nullif(trim(p_notes),'')) then raise exception 'This refund form was already used. Reload';end if;
  return previous.id;
 end if;
 if r.cancelled_at is not null then raise exception 'This return was cancelled';end if;
 select movement_date into returned_on from public.inventory_movements where id=r.movement_id;
 if p_date<returned_on then raise exception 'The refund received date cannot precede the return';end if;
 insert into public.supplier_refunds(id,return_id,amount_cents,paid_on,reference,notes,created_by)
 values(p_request,p_return,p_amount,p_date,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
 return p_request;
end;$$;
create function public.reverse_supplier_refund(p_refund uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a refund correction reason';end if;
 select return_id into r from public.supplier_refunds where id=p_refund;
 if not found then raise exception 'Refund not found';end if;
 perform 1 from public.supplier_returns where id=r for update;
 update public.supplier_refunds set reversed_at=now(),reversed_by=auth.uid(),reverse_reason=trim(p_reason) where id=p_refund and reversed_at is null;
end;$$;
-- Keep the ordinary stock reversal action from bypassing the return lifecycle.
create function public.guard_supplier_return_reversal() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.reverses_id is not null and exists(select 1 from public.supplier_returns where movement_id=new.reverses_id and cancelled_at is null) then
 raise exception 'Correct this supplier return from Supplier returns, after correcting its refund entries';end if;return new;end;$$;
create trigger supplier_return_reversal before insert on public.inventory_movements for each row execute function public.guard_supplier_return_reversal();
create function public.cancel_supplier_return(p_return uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.supplier_returns;product uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a return correction reason';end if;
 select m.product_id into product from public.supplier_returns s join public.inventory_movements m on m.id=s.movement_id where s.id=p_return;
 perform 1 from public.inventory_products where id=product for update;
 select * into r from public.supplier_returns where id=p_return for update;
 if not found then raise exception 'Return not found';end if;
 if r.cancelled_at is not null then return;end if;
 if exists(select 1 from public.supplier_refunds where return_id=r.id and reversed_at is null) then raise exception 'Correct active refund records before cancelling this mistaken return entry';end if;
 update public.supplier_returns set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason) where id=r.id;
 perform public.reverse_stock_consumption(r.movement_id,'Mistaken supplier return: '||trim(p_reason));
end;$$;
create function public.supplier_return_overview(p_page integer default 1,p_return uuid default null,p_refund_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 or p_refund_page is null or p_refund_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with page as (
 select r.*,m.product_id,p.name as product_name,m.entered_quantity as quantity,m.unit_label,m.movement_date as returned_on,-m.value_delta_cents as stock_cost_cents,
 (select coalesce(sum(amount_cents),0) from public.supplier_refunds where return_id=r.id and reversed_at is null) as refunded_cents,
 (select count(*) from public.supplier_refunds where return_id=r.id) as refund_count,
 (select coalesce(jsonb_agg(f order by f.created_at desc,f.id),'[]') from (select id,amount_cents,paid_on,reference,notes,reversed_at,reverse_reason,created_at from public.supplier_refunds where return_id=r.id order by created_at desc,id limit 20 offset (p_refund_page-1)*20) f) as refunds
 from public.supplier_returns r join public.inventory_movements m on m.id=r.movement_id join public.inventory_products p on p.id=m.product_id
 where p_return is null or r.id=p_return
 order by r.created_at desc,r.id limit 25 offset (p_page-1)*25
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by created_at desc,id) from page),'[]'),'total',(select count(*) from public.supplier_returns where p_return is null or id=p_return)) into result;
 return result;
end;$$;
revoke all on function public.record_supplier_return(uuid,uuid,uuid,numeric,date,text,text),public.record_supplier_refund(uuid,uuid,integer,date,text,text),public.reverse_supplier_refund(uuid,text),public.cancel_supplier_return(uuid,text),public.supplier_return_overview(integer,uuid,integer),public.guard_supplier_return_reversal() from public,anon;
grant execute on function public.record_supplier_return(uuid,uuid,uuid,numeric,date,text,text),public.record_supplier_refund(uuid,uuid,integer,date,text,text),public.reverse_supplier_refund(uuid,text),public.cancel_supplier_return(uuid,text),public.supplier_return_overview(integer,uuid,integer) to authenticated;
create or replace function public.cash_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare received bigint; spent bigint; refunds bigint; outstanding bigint; overdue bigint; breakdown jsonb; monthly jsonb;
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
  select coalesce(sum(amount_cents),0) into refunds from public.supplier_refunds where reversed_at is null and paid_on between p_from and p_to;
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
      (select coalesce(sum(e.amount_cents),0) from public.expenses e where e.voided_at is null and e.paid_on between p_from and p_to and date_trunc('month',e.paid_on)=m) as spent_cents,
      (select coalesce(sum(r.amount_cents),0) from public.supplier_refunds r where r.reversed_at is null and r.paid_on between p_from and p_to and date_trunc('month',r.paid_on)=m) as supplier_refunds_cents
    from generate_series(date_trunc('month',p_from),date_trunc('month',p_to),interval '1 month') m
  ) x;
  return jsonb_build_object('received_cents',received,'spent_cents',spent,'supplier_refunds_cents',refunds,'net_cents',received-spent+refunds,
    'outstanding_cents',outstanding,'overdue_cents',overdue,'categories',breakdown,'months',monthly);
end $$;
create or replace function public.admin_financial_overview() returns jsonb
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
    union all
    select r.id,'supplier_return',coalesce(r.cancelled_at,r.created_at),case when r.cancelled_at is null then 'Stock returned to supplier' else 'Supplier return entry cancelled' end,r.vendor,'/admin/inventory/returns' from public.supplier_returns r
    union all
    select f.id,'supplier_refund',coalesce(f.reversed_at,f.created_at),case when f.reversed_at is null then 'Supplier refund recorded' else 'Supplier refund entry reversed' end,r.vendor,'/admin/inventory/returns' from public.supplier_refunds f join public.supplier_returns r on r.id=f.return_id
  ), latest as (select * from records order by event_at desc,kind,id limit 8)
  select coalesce(jsonb_agg(latest order by event_at desc,kind,id),'[]') into recent from latest;
  return jsonb_build_object('as_of',current_day,'month_from',date_trunc('month',current_day)::date,
    'received_cents',cash->'received_cents','spent_cents',cash->'spent_cents','net_cents',cash->'net_cents','supplier_refunds_cents',cash->'supplier_refunds_cents',
    'outstanding_cents',cash->'outstanding_cents','overdue_cents',cash->'overdue_cents',
    'outstanding_count',(select count(*) from public.invoice_totals where status='issued' and balance_cents>0),
    'overdue_count',(select count(*) from public.invoice_totals where status='issued' and balance_cents>0 and due_date<current_day),'recent',recent);
end $$;
commit;
