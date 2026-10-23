begin;
create table public.expense_payment_assignments (
 id uuid primary key,payment_id uuid not null references public.invoice_payments(id),expense_id uuid not null references public.expenses(id),
 amount_cents integer not null check(amount_cents between 1 and 100000000),reason text not null check(length(trim(reason)) between 1 and 2000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 retired_at timestamptz,retired_by uuid references auth.users(id),retired_reason text
);
create unique index one_active_expense_payment_assignment on public.expense_payment_assignments(payment_id,expense_id) where retired_at is null;
alter table public.expense_payment_assignments enable row level security;
revoke all on public.expense_payment_assignments from public,anon,authenticated;
grant select on public.expense_payment_assignments to authenticated;
create policy admin_read on public.expense_payment_assignments for select to authenticated using(public.is_admin());
create function public.expense_invoice_cost(p_expense uuid,p_invoice uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(sum(cost),0)::bigint from (
 select e.amount_cents::bigint cost from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id join public.expenses e on e.id=c.expense_id where c.expense_id=p_expense and l.invoice_id=p_invoice
 union all select coalesce((l.source_snapshot->>'original_cost_cents')::bigint,l.amount_cents::bigint) from public.invoice_boarding_claims c join public.invoice_lines l on l.id=c.line_id where c.expense_id=p_expense and l.invoice_id=p_invoice
 ) x
$$;
revoke all on function public.expense_invoice_cost(uuid,uuid) from public,anon,authenticated;
create function public.assign_expense_payment(p_request uuid,p_current uuid,p_payment uuid,p_expense uuid,p_cents integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.invoice_payments;i public.invoices;e public.expenses;old public.expense_payment_assignments;active_id uuid;used bigint;recovered bigint;all_recovered bigint;cap bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_cents is null or p_cents<=0 then raise exception 'Enter an amount and assignment reason';end if;
 select * into p from public.invoice_payments where id=p_payment;
 if not found then raise exception 'Payment not found';end if;
 select * into i from public.invoices where id=p.invoice_id for update;
 select * into e from public.expenses where id=p_expense for update;
 if not found then raise exception 'Expense not found';end if;
 select * into p from public.invoice_payments where id=p_payment for update;
 select * into old from public.expense_payment_assignments where id=p_request;
 if found then
  if row(old.payment_id,old.expense_id,old.amount_cents,old.reason) is distinct from row(p_payment,p_expense,p_cents,trim(p_reason)) then raise exception 'This assignment form was already used. Reload before continuing';end if;
  return old.id;
 end if;
 if i.status<>'issued' or p.reversed_at is not null or e.voided_at is not null then raise exception 'Choose an active payment on an issued invoice and a non-voided expense';end if;
 select id into active_id from public.expense_payment_assignments where payment_id=p.id and expense_id=e.id and retired_at is null;
 if active_id is distinct from p_current then raise exception 'This assignment changed. Reload before saving';end if;
 cap:=public.expense_invoice_cost(e.id,i.id);
 if cap<=0 then raise exception 'This expense has no linked original cost on this invoice';end if;
 select coalesce(sum(amount_cents),0) into used from public.expense_payment_assignments where payment_id=p.id and retired_at is null and id is distinct from p_current;
 select coalesce(sum(a.amount_cents),0),coalesce(sum(a.amount_cents) filter(where ip.invoice_id=i.id),0) into all_recovered,recovered
 from public.expense_payment_assignments a join public.invoice_payments ip on ip.id=a.payment_id join public.invoices inv on inv.id=ip.invoice_id
 where a.expense_id=e.id and a.retired_at is null and ip.reversed_at is null and inv.status='issued' and a.id is distinct from p_current;
 if used+p_cents>p.amount_cents then raise exception 'Amount exceeds the unassigned part of this payment';end if;
 if recovered+p_cents>cap or all_recovered+p_cents>e.amount_cents then raise exception 'Amount exceeds the linked original expense cost still unrecovered';end if;
 update public.expense_payment_assignments set retired_at=now(),retired_by=auth.uid(),retired_reason='Replaced: '||trim(p_reason) where id=p_current;
 insert into public.expense_payment_assignments(id,payment_id,expense_id,amount_cents,reason,created_by) values(p_request,p.id,e.id,p_cents,trim(p_reason),auth.uid());return p_request;
end;$$;
create function public.clear_expense_payment(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare invoice uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a removal reason';end if;
 select p.invoice_id into invoice from public.expense_payment_assignments a join public.invoice_payments p on p.id=a.payment_id where a.id=p_id;
 if not found then raise exception 'Assignment not found';end if;
 perform 1 from public.invoices where id=invoice for update;
 update public.expense_payment_assignments set retired_at=coalesce(retired_at,now()),retired_by=coalesce(retired_by,auth.uid()),retired_reason=coalesce(retired_reason,trim(p_reason)) where id=p_id;
end;$$;
create function public.invoice_expense_recovery(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 return jsonb_build_object('payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'paid_on',p.paid_on,'amount_cents',p.amount_cents,'available_cents',p.amount_cents-coalesce((select sum(a.amount_cents) from public.expense_payment_assignments a where a.payment_id=p.id and a.retired_at is null),0)) order by p.paid_on,p.id) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where p.invoice_id=p_invoice and p.reversed_at is null and i.status='issued'),'[]'),
 'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'vendor',e.vendor,'expense_date',e.expense_date,'cost_cents',public.expense_invoice_cost(e.id,p_invoice))) from public.expenses e where e.voided_at is null and public.expense_invoice_cost(e.id,p_invoice)>0),'[]'),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('vendor',e.vendor,'counted',a.retired_at is null and p.reversed_at is null and i.status='issued' and e.voided_at is null) order by a.created_at desc,a.id) from public.expense_payment_assignments a join public.invoice_payments p on p.id=a.payment_id join public.invoices i on i.id=p.invoice_id join public.expenses e on e.id=a.expense_id where p.invoice_id=p_invoice),'[]'));
end;$$;
revoke all on function public.assign_expense_payment(uuid,uuid,uuid,uuid,integer,text),public.clear_expense_payment(uuid,text),public.invoice_expense_recovery(uuid) from public,anon;
grant execute on function public.assign_expense_payment(uuid,uuid,uuid,uuid,integer,text),public.clear_expense_payment(uuid,text),public.invoice_expense_recovery(uuid) to authenticated;
create function public.expense_recovery_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of at most ten years';end if;
 with costs as (
  select e.*,c.name as category_name,h.barn_name as horse_name from public.expenses e
  join public.expense_categories c on c.id=e.category_id left join public.horses h on h.id=e.horse_id
  where e.voided_at is null and e.paid_on between p_from and p_to
 ), sources as (
  select c.expense_id,l.invoice_id,l.id as line_id,e.amount_cents::bigint as cost_cents,l.amount_cents::bigint as charge_cents
  from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id join costs e on e.id=c.expense_id
  union all
  select c.expense_id,l.invoice_id,l.id,coalesce((l.source_snapshot->>'original_cost_cents')::bigint,l.amount_cents::bigint),l.amount_cents::bigint
  from public.invoice_boarding_claims c join public.invoice_lines l on l.id=c.line_id join costs e on e.id=c.expense_id
 ), linked as (
  select s.*,i.status,i.invoice_number,i.due_date,i.balance_cents,
   coalesce(i.customer_snapshot->>'name',c.name) as customer_name
  from sources s join public.invoice_totals i on i.id=s.invoice_id join public.customers c on c.id=i.customer_id where i.status in ('draft','issued')
 ), summaries as (
  select expense_id,coalesce(sum(cost_cents) filter(where status='issued'),0) as issued_cost_cents,
   coalesce(sum(cost_cents) filter(where status='draft'),0) as draft_cost_cents,
   coalesce(sum(charge_cents-cost_cents) filter(where status='issued'),0) as issued_fee_cents,
   jsonb_agg(jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'status',status,'customer_name',customer_name,'cost_cents',cost_cents,'charge_cents',charge_cents,'balance_cents',balance_cents,'due_date',due_date) order by due_date,invoice_id,line_id) as invoices
  from linked group by expense_id
 ), rows as (
  select e.id,e.vendor,e.expense_date,e.paid_on,e.category_name,e.horse_name,e.amount_cents,e.reimbursable,
   coalesce(s.issued_cost_cents,0) as issued_cost_cents,coalesce(s.draft_cost_cents,0) as draft_cost_cents,
   greatest(e.amount_cents-coalesce(s.issued_cost_cents,0)-coalesce(s.draft_cost_cents,0),0) as unbilled_cost_cents,
   coalesce(s.issued_fee_cents,0) as issued_fee_cents,coalesce(s.invoices,'[]') as invoices,
   coalesce((select sum(a.amount_cents) from public.expense_payment_assignments a join public.invoice_payments p on p.id=a.payment_id join public.invoices i on i.id=p.invoice_id where a.expense_id=e.id and a.retired_at is null and p.reversed_at is null and i.status='issued'),0) as recovered_cents
  from costs e left join summaries s on s.expense_id=e.id
 ) select jsonb_build_object('totals',(select jsonb_build_object('recovered_cents',coalesce(sum(recovered_cents),0),'not_recovered_cents',coalesce(sum(amount_cents-recovered_cents),0),'paid_cost_cents',coalesce(sum(amount_cents),0),'issued_cost_cents',coalesce(sum(issued_cost_cents),0),'draft_cost_cents',coalesce(sum(draft_cost_cents),0),'unbilled_cost_cents',coalesce(sum(unbilled_cost_cents),0),'unbilled_reimbursable_cents',coalesce(sum(unbilled_cost_cents) filter(where reimbursable),0),'other_unbilled_cents',coalesce(sum(unbilled_cost_cents) filter(where not reimbursable),0),'issued_fee_cents',coalesce(sum(issued_fee_cents),0)) from rows),
 'count',(select count(*) from rows),'expenses',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from rows order by paid_on desc,id limit 100) r),'[]')) into result;
 return result;
end;$$;
revoke all on function public.expense_recovery_report(date,date) from public,anon;
grant execute on function public.expense_recovery_report(date,date) to authenticated;
commit;
