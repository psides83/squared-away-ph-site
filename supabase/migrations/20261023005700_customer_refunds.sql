begin;
create table public.invoice_refunds (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),payment_id uuid not null references public.invoice_payments(id),
 refunded_on date not null,amount_cents integer not null check(amount_cents between 1 and 100000000),
 effect text not null check(effect in ('reduce','reopen')),method text not null check(method in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other')),
 reason text not null check(length(trim(reason)) between 1 and 500),reference text check(length(reference)<=200),notes text check(length(notes)<=2000),
 adjustment_id uuid unique references public.invoice_adjustments(id),created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 reversed_at timestamptz,reversed_by uuid references auth.users(id),reversal_reason text,reverse_adjustment_id uuid unique references public.invoice_adjustments(id)
);
create index invoice_refunds_invoice on public.invoice_refunds(invoice_id,created_at desc);
create index invoice_refunds_payment on public.invoice_refunds(payment_id) where reversed_at is null;
alter table public.invoice_refunds enable row level security;
revoke all on public.invoice_refunds from public,anon,authenticated;
grant select on public.invoice_refunds to authenticated;
create policy admin_read on public.invoice_refunds for select to authenticated using ((select public.is_admin()));
create function public.payment_refunded(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$select coalesce(sum(amount_cents),0)::bigint from public.invoice_refunds where payment_id=p_payment and reversed_at is null$$;
revoke all on function public.payment_refunded(uuid) from public,anon,authenticated;
create or replace view public.invoice_totals with(security_invoker=true) as
with amounts as (
 select i.*,
 coalesce(i.issued_total_cents,(select coalesce(sum(amount_cents),0) from public.invoice_lines l where l.invoice_id=i.id))::bigint as base_cents,
 (select coalesce(sum(amount_cents),0) from public.invoice_adjustments a where a.invoice_id=i.id)::bigint as adjustment_cents,
 ((select coalesce(sum(amount_cents),0) from public.invoice_payments p where p.invoice_id=i.id and reversed_at is null)-(select coalesce(sum(amount_cents),0) from public.invoice_refunds r where r.invoice_id=i.id and reversed_at is null))::bigint as paid_cents
 from public.invoices i
) select amounts.*,base_cents+adjustment_cents as total_cents,base_cents+adjustment_cents-paid_cents as balance_cents,
 (select coalesce(sum(amount_cents),0) from public.invoice_payments p where p.invoice_id=amounts.id and reversed_at is null)::bigint as gross_paid_cents,
 (select coalesce(sum(amount_cents),0) from public.invoice_refunds r where r.invoice_id=amounts.id and reversed_at is null)::bigint as refunded_cents from amounts;
create function public.record_invoice_refund(p_request uuid,p_payment uuid,p_amount integer,p_date date,p_effect text,p_method text,p_reason text,p_reference text default null,p_notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.invoice_refunds;p public.invoice_payments;i public.invoice_totals;used bigint;adjustment uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_amount is null or p_amount not between 1 and 100000000 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_effect is null or p_effect not in ('reduce','reopen') or p_method is null or p_method not in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other') or p_reason is null or length(trim(p_reason)) not between 1 and 500 or length(p_reference)>200 or length(p_notes)>2000 then raise exception 'Enter the actual refund amount, date, method, invoice effect and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.invoice_refunds where id=p_request;
 if found then
 if row(prior.payment_id,prior.amount_cents,prior.refunded_on,prior.effect,prior.method,prior.reason,prior.reference,prior.notes) is distinct from row(p_payment,p_amount,p_date,p_effect,p_method,trim(p_reason),nullif(trim(p_reference),''),nullif(trim(p_notes),'')) then raise exception 'This refund form was already saved. Open a new form';end if;
 return prior.id;
 end if;
 select * into p from public.invoice_payments where id=p_payment;
 if not found then raise exception 'Payment not found';end if;
 perform 1 from public.invoices where id=p.invoice_id for update;
 select * into p from public.invoice_payments where id=p_payment for update;
 select * into i from public.invoice_totals where id=p.invoice_id;
 if i.status<>'issued' or p.reversed_at is not null then raise exception 'Choose an active received payment on a finalized invoice';end if;
 if p_date<p.paid_on then raise exception 'The refund date cannot precede the received payment';end if;
 select coalesce(sum(amount_cents),0) into used from public.expense_payment_assignments where payment_id=p.id and retired_at is null;
 if p_amount+public.payment_refunded(p.id)>p.amount_cents then raise exception 'Refund exceeds the amount still retained from this payment';end if;
 if used+p_amount+public.payment_refunded(p.id)>p.amount_cents then raise exception 'Reduce or clear this payment’s expense-recovery assignments before refunding the assigned money';end if;
 if p_effect='reduce' then
 adjustment:=gen_random_uuid();
 insert into public.invoice_adjustments(id,invoice_id,adjustment_date,amount_cents,description) values(adjustment,i.id,p_date,-p_amount,'Refund: '||left(trim(p_reason),492));
 end if;
 insert into public.invoice_refunds(id,invoice_id,payment_id,refunded_on,amount_cents,effect,method,reason,reference,notes,adjustment_id,created_by)
 values(p_request,i.id,p.id,p_date,p_amount,p_effect,p_method,trim(p_reason),nullif(trim(p_reference),''),nullif(trim(p_notes),''),adjustment,auth.uid());
 return p_request;
end;$$;
create function public.reverse_invoice_refund(p_refund uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.invoice_refunds;i public.invoice_totals;adjustment uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a correction reason';end if;
 select * into r from public.invoice_refunds where id=p_refund;
 if not found then raise exception 'Refund not found';end if;
 perform 1 from public.invoices where id=r.invoice_id for update;
 select * into r from public.invoice_refunds where id=p_refund for update;
 if r.reversed_at is not null then return;end if;
 select * into i from public.invoice_totals where id=r.invoice_id;
 if i.status<>'issued' then raise exception 'Correct refunds only on finalized, non-voided invoices';end if;
 if r.effect='reopen' and i.balance_cents<r.amount_cents then raise exception 'This refund’s reopened balance has since been paid or reduced. Correct those later entries before reversing this mistaken refund';end if;
 if r.effect='reduce' then
 if i.total_cents+r.amount_cents>1000000000 then raise exception 'Reversing this credit would exceed the invoice limit. Review later adjustments first';end if;
 adjustment:=gen_random_uuid();
 insert into public.invoice_adjustments(id,invoice_id,adjustment_date,amount_cents,description) values(adjustment,r.invoice_id,r.refunded_on,r.amount_cents,'Reverse mistaken refund: '||left(r.reason,475));
 end if;
 update public.invoice_refunds set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=trim(p_reason),reverse_adjustment_id=adjustment where id=r.id;
end;$$;
create function public.guard_refunded_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.reversed_at is not null or new.amount_cents<>old.amount_cents or new.invoice_id<>old.invoice_id or new.paid_on<>old.paid_on) and exists(select 1 from public.invoice_refunds where payment_id=old.id and reversed_at is null) then raise exception 'Correct active refund records before reversing or changing their source payment';end if;
 return new;
end;$$;
create trigger refunded_payment_guard before update on public.invoice_payments for each row execute function public.guard_refunded_payment();
create function public.guard_refunded_invoice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='void' and old.status<>'void' and exists(select 1 from public.invoice_refunds where invoice_id=old.id and reversed_at is null) then raise exception 'Refunded invoices retain their issued history. Correct mistaken refund records before voiding';end if;return new;
end;$$;
create trigger refunded_invoice_guard before update on public.invoices for each row execute function public.guard_refunded_invoice();
create function public.invoice_refund_overview(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid refund page';end if;
 select jsonb_build_object('total',(select count(*) from public.invoice_refunds where invoice_id=p_invoice),
 'refunded_cents',(select coalesce(sum(amount_cents),0) from public.invoice_refunds where invoice_id=p_invoice and reversed_at is null),
 'rows',coalesce((select jsonb_agg(x order by created_at desc,id) from (select r.*,p.paid_on as original_paid_on from public.invoice_refunds r join public.invoice_payments p on p.id=r.payment_id where r.invoice_id=p_invoice order by r.created_at desc,r.id limit 25 offset (p_page-1)*25) x),'[]'),
 'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select p.id,p.paid_on,p.amount_cents,p.method,public.payment_refunded(p.id) as refunded_cents,
 p.amount_cents-public.payment_refunded(p.id)-coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0) as available_cents
 from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where p.invoice_id=p_invoice and p.reversed_at is null and i.status='issued' and p.amount_cents-public.payment_refunded(p.id)-coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0)>0 order by p.paid_on,p.id limit 100) x),'[]')) into result;
 return result;
end;$$;
revoke all on function public.record_invoice_refund(uuid,uuid,integer,date,text,text,text,text,text),public.reverse_invoice_refund(uuid,text),public.invoice_refund_overview(uuid,integer),public.guard_refunded_payment(),public.guard_refunded_invoice() from public,anon;
revoke all on function public.guard_refunded_payment(),public.guard_refunded_invoice() from authenticated;
grant execute on function public.record_invoice_refund(uuid,uuid,integer,date,text,text,text,text,text),public.reverse_invoice_refund(uuid,text),public.invoice_refund_overview(uuid,integer) to authenticated;

create or replace view public.reporting_receipts with(security_invoker=true) as
select p.id as payment_id,p.invoice_id,p.paid_on,p.amount_cents,coalesce(s.horse_id,l.horse_id) as horse_id,coalesce(i.stay_id,l.stay_id) as stay_id
from public.invoice_payments p join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and p.reversed_at is null
union all
select r.id,r.invoice_id,r.refunded_on,-r.amount_cents,coalesce(s.horse_id,l.horse_id),coalesce(i.stay_id,l.stay_id)
from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and r.reversed_at is null;
create or replace function public.assign_expense_payment(p_request uuid,p_current uuid,p_payment uuid,p_expense uuid,p_cents integer,p_reason text) returns uuid
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
 if used+p_cents>p.amount_cents-public.payment_refunded(p.id) then raise exception 'Amount exceeds the unassigned part of this payment';end if;
 if recovered+p_cents>cap or all_recovered+p_cents>e.amount_cents then raise exception 'Amount exceeds the linked original expense cost still unrecovered';end if;
 update public.expense_payment_assignments set retired_at=now(),retired_by=auth.uid(),retired_reason='Replaced: '||trim(p_reason) where id=p_current;
 insert into public.expense_payment_assignments(id,payment_id,expense_id,amount_cents,reason,created_by) values(p_request,p.id,e.id,p_cents,trim(p_reason),auth.uid());return p_request;
end;$$;
create or replace function public.invoice_expense_recovery(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 return jsonb_build_object('payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'paid_on',p.paid_on,'amount_cents',p.amount_cents,'available_cents',p.amount_cents-public.payment_refunded(p.id)-coalesce((select sum(a.amount_cents) from public.expense_payment_assignments a where a.payment_id=p.id and a.retired_at is null),0)) order by p.paid_on,p.id) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where p.invoice_id=p_invoice and p.reversed_at is null and i.status='issued'),'[]'),
 'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'vendor',e.vendor,'expense_date',e.expense_date,'cost_cents',public.expense_invoice_cost(e.id,p_invoice))) from public.expenses e where e.voided_at is null and public.expense_invoice_cost(e.id,p_invoice)>0),'[]'),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('vendor',e.vendor,'counted',a.retired_at is null and p.reversed_at is null and i.status='issued' and e.voided_at is null) order by a.created_at desc,a.id) from public.expense_payment_assignments a join public.invoice_payments p on p.id=a.payment_id join public.invoices i on i.id=p.invoice_id join public.expenses e on e.id=a.expense_id where p.invoice_id=p_invoice),'[]'));
end;$$;
create or replace function public.cash_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare returned bigint; received bigint; spent bigint; refunds bigint; outstanding bigint; overdue bigint; breakdown jsonb; monthly jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then
    raise exception 'Choose a valid reporting period of at most ten years';
  end if;
  select coalesce(sum(p.amount_cents),0) into received from public.invoice_payments p
    join public.invoices i on i.id=p.invoice_id
    where p.reversed_at is null and i.status='issued' and p.paid_on between p_from and p_to;
  select coalesce(sum(e.amount_cents-public.supplier_credit_used(e.id)),0) into spent from public.expenses e
    where e.voided_at is null and e.paid_on between p_from and p_to;
  select coalesce(sum(amount_cents),0) into refunds from public.supplier_refunds where reversed_at is null and paid_on between p_from and p_to;
  select coalesce(sum(amount_cents),0) into returned from public.invoice_refunds where reversed_at is null and refunded_on between p_from and p_to;
  select coalesce(sum(balance_cents),0),coalesce(sum(balance_cents) filter(where due_date<(now() at time zone 'America/Chicago')::date),0)
    into outstanding,overdue from public.invoice_totals where status='issued' and balance_cents>0;
  select coalesce(jsonb_agg(x order by x.amount_cents desc,x.name),'[]') into breakdown from (
    select coalesce(c.name,'Uncategorized') as name,sum(e.amount_cents-public.supplier_credit_used(e.id)) as amount_cents,count(*) as expense_count
    from public.expenses e left join public.expense_categories c on c.id=e.category_id
    where e.voided_at is null and e.paid_on between p_from and p_to group by c.id,c.name
  ) x;
  select coalesce(jsonb_agg(x order by x.month),'[]') into monthly from (
    select to_char(m,'YYYY-MM') as month,
      (select coalesce(sum(p.amount_cents),0) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id
        where p.reversed_at is null and i.status='issued' and p.paid_on between p_from and p_to and date_trunc('month',p.paid_on)=m) as received_cents,
      (select coalesce(sum(e.amount_cents-public.supplier_credit_used(e.id)),0) from public.expenses e where e.voided_at is null and e.paid_on between p_from and p_to and date_trunc('month',e.paid_on)=m) as spent_cents,
      (select coalesce(sum(a.amount_cents),0) from public.supplier_credit_applications a join public.expenses e on e.id=a.expense_id where a.reversed_at is null and e.voided_at is null and e.paid_on between p_from and p_to and date_trunc('month',e.paid_on)=m) as supplier_credit_used_cents,
      (select coalesce(sum(r.amount_cents),0) from public.supplier_refunds r where r.reversed_at is null and r.paid_on between p_from and p_to and date_trunc('month',r.paid_on)=m) as supplier_refunds_cents,
      (select coalesce(sum(r.amount_cents),0) from public.invoice_refunds r where r.reversed_at is null and r.refunded_on between p_from and p_to and date_trunc('month',r.refunded_on)=m) as customer_refunds_cents
    from generate_series(date_trunc('month',p_from),date_trunc('month',p_to),interval '1 month') m
  ) x;
  return jsonb_build_object('supplier_credit_used_cents',(select coalesce(sum(a.amount_cents),0) from public.supplier_credit_applications a join public.expenses e on e.id=a.expense_id where a.reversed_at is null and e.voided_at is null and e.paid_on between p_from and p_to),'received_cents',received,'spent_cents',spent,'supplier_refunds_cents',refunds,'customer_refunds_cents',returned,'net_cents',received-spent+refunds-returned,
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
    select r.id,'customer_refund',coalesce(r.reversed_at,r.created_at),case when r.reversed_at is null then 'Customer refund recorded' else 'Customer refund record reversed' end,coalesce(i.customer_snapshot->>'name',c.name),'/admin/invoices/'||i.id::text||'#invoice-refunds' from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id join public.customers c on c.id=i.customer_id
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
    'received_cents',cash->'received_cents','spent_cents',cash->'spent_cents','net_cents',cash->'net_cents','supplier_refunds_cents',cash->'supplier_refunds_cents','customer_refunds_cents',cash->'customer_refunds_cents',
    'outstanding_cents',cash->'outstanding_cents','overdue_cents',cash->'overdue_cents',
    'outstanding_count',(select count(*) from public.invoice_totals where status='issued' and balance_cents>0),
    'overdue_count',(select count(*) from public.invoice_totals where status='issued' and balance_cents>0 and due_date<current_day),'recent',recent);
end $$;
create or replace function public.portal_invoice(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();i public.invoice_totals;result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select * into i from public.invoice_totals where id=p_invoice and customer_id=customer and status in ('issued','void');
  if not found then return null; end if;
  result:=jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'issue_date',i.issue_date,'due_date',i.due_date,'period_from',i.period_from,'period_to',i.period_to,'status',i.status,
    'customer',i.customer_snapshot,'business',i.business_snapshot,'notes',i.notes,'base_cents',i.base_cents,'adjustment_cents',i.adjustment_cents,'total_cents',i.total_cents,'gross_paid_cents',i.gross_paid_cents,'refunded_cents',i.refunded_cents,'paid_cents',i.paid_cents,'balance_cents',i.balance_cents,
    'lines',public.invoice_display_lines(i.id,coalesce(i.customer_snapshot->>'invoice_presentation','itemized')='combined_services'),
    'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select id,paid_on,amount_cents,method,(reversed_at is not null) as reversed from public.invoice_payments where invoice_id=i.id) x),'[]'),
    'refunds',coalesce((select jsonb_agg(x order by refunded_on,id) from (select id,refunded_on,amount_cents,method,effect,reason,reference,(reversed_at is not null) as reversed from public.invoice_refunds where invoice_id=i.id) x),'[]'),
    'adjustments',coalesce((select jsonb_agg(x order by adjustment_date,id) from (select id,adjustment_date,description,amount_cents from public.invoice_adjustments where invoice_id=i.id) x),'[]'));
  return result;
end $$;
commit;
