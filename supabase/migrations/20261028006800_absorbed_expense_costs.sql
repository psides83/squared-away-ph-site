begin;
create table public.expense_absorptions (
 id uuid primary key,expense_id uuid not null references public.expenses(id),previous_id uuid references public.expense_absorptions(id),
 amount_cents integer not null check(amount_cents between 0 and 100000000),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),retired_at timestamptz
);
create index expense_absorption_history on public.expense_absorptions(expense_id,created_at desc,id desc);
create unique index one_current_expense_absorption on public.expense_absorptions(expense_id) where retired_at is null;
alter table public.expense_absorptions enable row level security;
revoke all on public.expense_absorptions from public,anon,authenticated;
grant select on public.expense_absorptions to authenticated;
create policy admin_read on public.expense_absorptions for select to authenticated using(public.is_admin());
create function public.expense_absorbed(p_expense uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select amount_cents::bigint from public.expense_absorptions where expense_id=p_expense and retired_at is null),0)
$$;
revoke all on function public.expense_absorbed(uuid) from public,anon,authenticated;
-- Both charge-backs and boarding reserve original cost, excluding fees.
create view public.expense_billing_costs with(security_invoker=true) as
select c.expense_id,l.invoice_id,coalesce((l.source_snapshot->>'original_cost_cents')::bigint,e.amount_cents::bigint) cost_cents
from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id join public.expenses e on e.id=c.expense_id join public.invoices i on i.id=l.invoice_id where i.status in ('draft','issued')
union all
select c.expense_id,l.invoice_id,coalesce((l.source_snapshot->>'original_cost_cents')::bigint,l.amount_cents::bigint)
from public.invoice_boarding_claims c join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id where i.status in ('draft','issued');
revoke all on public.expense_billing_costs from public,anon,authenticated;
create function public.set_expense_absorption(p_request uuid,p_current uuid,p_expense uuid,p_cents integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.expenses;prior public.expense_absorptions;current_id uuid;reserved bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_cents is null or p_cents not between 0 and 100000000 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a valid absorbed amount and reason';end if;
 select * into e from public.expenses where id=p_expense for update;
 if not found then raise exception 'Expense not found';end if;
 select * into prior from public.expense_absorptions where id=p_request;
 if found then
  if row(prior.expense_id,prior.previous_id,prior.amount_cents,prior.reason) is distinct from row(p_expense,p_current,p_cents,trim(p_reason)) then raise exception 'This form was already used. Reload before continuing';end if;
  return prior.id;
 end if;
 select id into current_id from public.expense_absorptions where expense_id=e.id and retired_at is null;
 if current_id is distinct from p_current then raise exception 'This absorbed amount changed. Reload before saving';end if;
 if p_cents>0 then
  if e.voided_at is not null then raise exception 'Cannot absorb a voided expense';end if;
  if exists(select 1 from public.inventory_movements where expense_id=e.id) then raise exception 'Feed purchases are billed through consumption. This designation supports expense charge-backs and boarding costs only';end if;
 end if;
 select coalesce(sum(cost_cents),0) into reserved from public.expense_billing_costs where expense_id=e.id;
 if reserved+p_cents>e.amount_cents then raise exception 'Amount overlaps cost already reserved on invoices. Remove the draft charge or revise the billing allocation first';end if;
 update public.expense_absorptions set retired_at=now() where id=current_id;
 insert into public.expense_absorptions(id,expense_id,previous_id,amount_cents,reason,created_by) values(p_request,e.id,p_current,p_cents,trim(p_reason),auth.uid());
 return p_request;
end;$$;
revoke all on function public.set_expense_absorption(uuid,uuid,uuid,integer,text) from public,anon;
grant execute on function public.set_expense_absorption(uuid,uuid,uuid,integer,text) to authenticated;
create function public.guard_absorbed_expense_billing() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.expenses;cost bigint;reserved bigint;
begin
 select * into e from public.expenses where id=new.expense_id for update;
 if public.expense_absorbed(e.id)=0 then return new;end if;
 select coalesce(sum(cost_cents),0) into reserved from public.expense_billing_costs where expense_id=e.id;
 select coalesce((source_snapshot->>'original_cost_cents')::bigint,case when tg_table_name='invoice_expense_claims' then e.amount_cents else amount_cents end) into cost from public.invoice_lines where id=new.line_id;
 if cost is null or cost<0 or reserved+cost+public.expense_absorbed(e.id)>e.amount_cents then raise exception 'This cost includes an absorbed amount or exceeds the expense. Revise the boarding split or explicitly remove the absorbed designation before billing';end if;
 return new;
end;$$;
revoke all on function public.guard_absorbed_expense_billing() from public,anon,authenticated;
create trigger protect_absorbed_chargeback before insert on public.invoice_expense_claims for each row execute function public.guard_absorbed_expense_billing();
create trigger protect_absorbed_boarding before insert on public.invoice_boarding_claims for each row execute function public.guard_absorbed_expense_billing();
create function public.guard_absorbed_expense_changes() returns trigger language plpgsql security definer set search_path='' as $$
declare absorbed bigint;reserved bigint;
begin
 absorbed:=public.expense_absorbed(old.id);
 if absorbed>0 then
  if new.voided_at is not null then raise exception 'Remove the absorbed designation before voiding this expense';end if;
  select coalesce(sum(cost_cents),0) into reserved from public.expense_billing_costs where expense_id=old.id;
  if new.amount_cents<absorbed+reserved then raise exception 'Expense amount cannot be less than its absorbed and invoice-reserved costs';end if;
 end if;
 return new;
end;$$;
revoke all on function public.guard_absorbed_expense_changes() from public,anon,authenticated;
create trigger protect_absorbed_expense before update on public.expenses for each row execute function public.guard_absorbed_expense_changes();
create or replace function public.add_expense_chargeback(p_invoice uuid,p_expense uuid,p_markup integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; e public.expenses%rowtype; s public.training_stays%rowtype; line uuid; existing uuid; billing_cost integer;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice and status='draft' for update;
  if not found then raise exception 'Choose a draft invoice'; end if;
  if p_markup is null or p_markup<0 or p_markup>100000000 then raise exception 'Enter a valid nonnegative handling fee'; end if;
  select * into e from public.expenses where id=p_expense and voided_at is null and reimbursable for update;
  if not found then raise exception 'Choose a non-voided expense flagged for charge-back'; end if;
  billing_cost:=e.amount_cents-public.expense_absorbed(e.id);
  if billing_cost<=0 then raise exception 'This expense is fully absorbed. Explicitly remove the designation before billing';end if;
  if billing_cost::bigint+p_markup>100000000 then raise exception 'Charge exceeds the supported invoice line amount';end if;
  if inv.stay_id is not null then
    select * into s from public.training_stays where id=inv.stay_id;
    if s.horse_id<>e.horse_id or s.billing_customer_id<>inv.customer_id then raise exception 'Expense horse does not match this training stay'; end if;
    if e.expense_date<s.arrival_date or (s.departure_date is not null and e.expense_date>s.departure_date) then raise exception 'Expense date falls outside this historical stay. Review its responsible customer before using a manual invoice.'; end if;
  elsif not exists(select 1 from public.horse_customers where horse_id=e.horse_id and customer_id=inv.customer_id) then
    raise exception 'Expense must match a horse linked to this customer; use its historical stay for a former owner';
  end if;
  select l.id into existing from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id where c.expense_id=p_expense and l.invoice_id=p_invoice;
  if found then
    if exists(select 1 from public.invoice_lines where id=existing and (coalesce((source_snapshot->>'original_cost_cents')::bigint,e.amount_cents)<>billing_cost or coalesce((source_snapshot->>'handling_fee_cents')::bigint,0)<>p_markup)) then raise exception 'Expense already added with a different fee or absorbed amount. Remove its draft line first.'; end if;
    return existing;
  end if;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot)
    values(p_invoice,'Expense reimbursement: '||coalesce(e.vendor,'provider')||' · '||e.expense_date::text,billing_cost+p_markup,'expense',jsonb_build_object('expense_id',e.id,'expense_date',e.expense_date,'original_cost_cents',billing_cost,'expense_total_cents',e.amount_cents,'absorbed_cost_cents',public.expense_absorbed(e.id),'handling_fee_cents',p_markup,'horse_id',e.horse_id)) returning id into line;
  insert into public.invoice_expense_claims(expense_id,line_id) values(e.id,line);
  return line;
end; $$;

create or replace function public.expense_invoice_cost(p_expense uuid,p_invoice uuid) returns bigint
language sql stable security definer set search_path='' as $$
 select coalesce(sum(cost),0)::bigint from (
 select coalesce((l.source_snapshot->>'original_cost_cents')::bigint,e.amount_cents::bigint) cost from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id join public.expenses e on e.id=c.expense_id where c.expense_id=p_expense and l.invoice_id=p_invoice
 union all select coalesce((l.source_snapshot->>'original_cost_cents')::bigint,l.amount_cents::bigint) from public.invoice_boarding_claims c join public.invoice_lines l on l.id=c.line_id where c.expense_id=p_expense and l.invoice_id=p_invoice
 ) x
$$;
revoke all on function public.expense_invoice_cost(uuid,uuid) from public,anon,authenticated;
create or replace function public.expense_followup(p_expenses uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_expenses is null or cardinality(p_expenses)>100 or array_position(p_expenses,null) is not null then raise exception 'Choose at most 100 expenses'; end if;
 with linked_lines as (
  select c.expense_id,l.id,l.invoice_id,coalesce((l.source_snapshot->>'original_cost_cents')::bigint,e.amount_cents::bigint) as cost_cents,l.amount_cents::bigint as charge_cents
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
   'absorbed_cost_cents',public.expense_absorbed(e.id),'unassigned_cost_cents',greatest(e.amount_cents-public.expense_absorbed(e.id)-coalesce((select sum(x.cost_cents) from on_invoice x where x.expense_id=e.id),0),0),
   'receipt_count',(select count(*) from public.expense_receipts r where r.expense_id=e.id),
   'draft_cost_cents',coalesce((select sum(x.cost_cents) from on_invoice x where x.expense_id=e.id and x.status='draft'),0),
   'issued_cost_cents',coalesce((select sum(x.cost_cents) from on_invoice x where x.expense_id=e.id and x.status='issued'),0),
   'invoices',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('customer_name',c.name) order by x.due_date,x.id) from on_invoice x join public.customers c on c.id=x.customer_id where x.expense_id=e.id),'[]'::jsonb)) order by e.id),'[]'::jsonb) into result
 from public.expenses e where e.id=any(p_expenses);
 return result;
end; $$;
revoke all on function public.expense_followup(uuid[]) from public,anon;
grant execute on function public.expense_followup(uuid[]) to authenticated;
create or replace function public.expense_recovery_report(p_from date,p_to date) returns jsonb
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
  select c.expense_id,l.invoice_id,l.id as line_id,coalesce((l.source_snapshot->>'original_cost_cents')::bigint,e.amount_cents::bigint) as cost_cents,l.amount_cents::bigint as charge_cents
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
  select e.id,e.vendor,e.expense_date,e.paid_on,e.category_name,e.horse_name,e.amount_cents,e.reimbursable,public.expense_absorbed(e.id) as absorbed_cost_cents,
   coalesce(s.issued_cost_cents,0) as issued_cost_cents,coalesce(s.draft_cost_cents,0) as draft_cost_cents,
   greatest(e.amount_cents-coalesce(s.issued_cost_cents,0)-coalesce(s.draft_cost_cents,0),0) as unbilled_cost_cents,
   coalesce(s.issued_fee_cents,0) as issued_fee_cents,coalesce(s.invoices,'[]') as invoices,
   coalesce((select sum(a.amount_cents) from public.expense_recovery_entries a where a.expense_id=e.id and a.active),0)
 as recovered_cents,
   coalesce((select sum(a.amount_cents) from public.expense_recovery_entries a where a.expense_id=e.id and a.active and a.source_kind='payment'),0) as cash_recovered_cents,
   coalesce((select sum(a.amount_cents) from public.expense_recovery_entries a where a.expense_id=e.id and a.active and a.source_kind='credit'),0) as credit_recovered_cents
  from costs e left join summaries s on s.expense_id=e.id
 ) select jsonb_build_object('totals',(select jsonb_build_object('cash_recovered_cents',coalesce(sum(cash_recovered_cents),0),'credit_recovered_cents',coalesce(sum(credit_recovered_cents),0),'recovered_cents',coalesce(sum(recovered_cents),0),'not_recovered_cents',coalesce(sum(amount_cents-recovered_cents),0),'paid_cost_cents',coalesce(sum(amount_cents),0),'issued_cost_cents',coalesce(sum(issued_cost_cents),0),'draft_cost_cents',coalesce(sum(draft_cost_cents),0),'unbilled_cost_cents',coalesce(sum(unbilled_cost_cents),0),'absorbed_cost_cents',coalesce(sum(absorbed_cost_cents),0),'undecided_cost_cents',coalesce(sum(unbilled_cost_cents-absorbed_cost_cents),0),'unbilled_reimbursable_cents',coalesce(sum(unbilled_cost_cents-absorbed_cost_cents) filter(where reimbursable),0),'other_unbilled_cents',coalesce(sum(unbilled_cost_cents-absorbed_cost_cents) filter(where not reimbursable),0),'issued_fee_cents',coalesce(sum(issued_fee_cents),0)) from rows),
 'count',(select count(*) from rows),'expenses',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from rows order by paid_on desc,id limit 100) r),'[]')) into result;
 return result;
end;$$;
revoke all on function public.expense_recovery_report(date,date) from public,anon;
grant execute on function public.expense_recovery_report(date,date) to authenticated;
commit;
