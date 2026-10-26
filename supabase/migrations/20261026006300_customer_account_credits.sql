begin;
-- Account money is distinct from invoice cash payments. Applications never create cash receipts.
create table public.customer_credits (
 id uuid primary key, customer_id uuid not null references public.customers(id),
 source text not null check(source in ('advance','invoice')),payment_id uuid references public.invoice_payments(id),
 credit_on date not null,amount_cents integer not null check(amount_cents between 1 and 100000000),
 method text check(method in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other')),
 reason text not null check(length(trim(reason)) between 1 and 500),reference text check(length(reference)<=200),
 adjustment_id uuid unique references public.invoice_adjustments(id),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 reversed_at timestamptz,reversed_by uuid references auth.users(id),reversal_reason text,reverse_adjustment_id uuid unique references public.invoice_adjustments(id),
 check((source='advance' and payment_id is null and method is not null and adjustment_id is null) or (source='invoice' and payment_id is not null and method is null and adjustment_id is not null))
);
create index customer_credits_customer on public.customer_credits(customer_id,created_at desc);
create table public.customer_credit_applications (
 id uuid primary key,credit_id uuid not null references public.customer_credits(id),invoice_id uuid not null references public.invoices(id),
 applied_on date not null,amount_cents integer not null check(amount_cents between 1 and 100000000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 reversed_at timestamptz,reversed_by uuid references auth.users(id),reversal_reason text
);
create index customer_credit_applications_invoice on public.customer_credit_applications(invoice_id);
create index customer_credit_applications_credit on public.customer_credit_applications(credit_id);
alter table public.customer_credits enable row level security;
alter table public.customer_credit_applications enable row level security;
revoke all on public.customer_credits,public.customer_credit_applications from public,anon,authenticated;
grant select on public.customer_credits,public.customer_credit_applications to authenticated;
create policy admin_read on public.customer_credits for select to authenticated using((select public.is_admin()));
create policy admin_read on public.customer_credit_applications for select to authenticated using((select public.is_admin()));
create function public.payment_credit_transferred(p_payment uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_cents),0)::bigint from public.customer_credits where payment_id=p_payment and reversed_at is null
$$;
revoke all on function public.payment_credit_transferred(uuid) from public,anon,authenticated;
create or replace view public.invoice_totals with(security_invoker=true) as
with amounts as (
 select i.*,
 coalesce(i.issued_total_cents,(select coalesce(sum(amount_cents),0) from public.invoice_lines l where l.invoice_id=i.id))::bigint as base_cents,
 (select coalesce(sum(amount_cents),0) from public.invoice_adjustments a where a.invoice_id=i.id)::bigint as adjustment_cents,
 ((select coalesce(sum(amount_cents),0) from public.invoice_payments p where p.invoice_id=i.id and reversed_at is null)-(select coalesce(sum(amount_cents),0) from public.invoice_refunds r where r.invoice_id=i.id and reversed_at is null)-(select coalesce(sum(c.amount_cents),0) from public.customer_credits c join public.invoice_payments p on p.id=c.payment_id where p.invoice_id=i.id and c.reversed_at is null)+(select coalesce(sum(a.amount_cents),0) from public.customer_credit_applications a where a.invoice_id=i.id and a.reversed_at is null))::bigint as paid_cents
 from public.invoices i
) select amounts.*,base_cents+adjustment_cents as total_cents,base_cents+adjustment_cents-paid_cents as balance_cents,
 (select coalesce(sum(amount_cents),0) from public.invoice_payments p where p.invoice_id=amounts.id and reversed_at is null)::bigint as gross_paid_cents,
 (select coalesce(sum(amount_cents),0) from public.invoice_refunds r where r.invoice_id=amounts.id and reversed_at is null)::bigint as refunded_cents,
 (select coalesce(sum(c.amount_cents),0) from public.customer_credits c join public.invoice_payments p on p.id=c.payment_id where p.invoice_id=amounts.id and c.reversed_at is null)::bigint as transferred_credit_cents,
 (select coalesce(sum(a.amount_cents),0) from public.customer_credit_applications a where a.invoice_id=amounts.id and a.reversed_at is null)::bigint as applied_credit_cents from amounts;

create function public.record_customer_credit(p_request uuid,p_customer uuid,p_source text,p_payment uuid,p_amount integer,p_date date,p_method text,p_reason text,p_reference text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.customer_credits;p public.invoice_payments;i public.invoice_totals;used bigint;adjustment uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_customer is null or p_source is null or p_source not in ('advance','invoice') or p_amount is null or p_amount not between 1 and 100000000 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_reason is null or length(trim(p_reason)) not between 1 and 500 or length(p_reference)>200 then raise exception 'Enter the credit source, positive amount, actual date and reason';end if;
 if (p_source='advance' and (p_payment is not null or p_method is null or p_method not in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other'))) or (p_source='invoice' and (p_payment is null or p_method is not null)) then raise exception 'Choose an actual advance payment method or a source invoice payment';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.customer_credits where id=p_request;
 if found then
 if row(prior.customer_id,prior.source,prior.payment_id,prior.amount_cents,prior.credit_on,prior.method,prior.reason,prior.reference) is distinct from row(p_customer,p_source,p_payment,p_amount,p_date,p_method,trim(p_reason),nullif(trim(p_reference),'')) then raise exception 'This credit form was already saved. Open a new form';end if;return prior.id;end if;
 perform 1 from public.customers where id=p_customer for update;
 if not found then raise exception 'Customer not found';end if;
 if p_source='invoice' then
 select * into p from public.invoice_payments where id=p_payment;
 perform 1 from public.invoices where id=p.invoice_id for update;
 select * into p from public.invoice_payments where id=p_payment for update;
 select * into i from public.invoice_totals where id=p.invoice_id;
 if i.id is null or i.customer_id<>p_customer or i.status<>'issued' or i.balance_cents<>0 or p.reversed_at is not null then raise exception 'Choose an active payment from this customer’s fully paid invoice';end if;
 if p_date<p.paid_on then raise exception 'Credit date cannot precede its source payment';end if;
 select coalesce(sum(amount_cents),0) into used from public.expense_payment_assignments where payment_id=p.id and retired_at is null;
 if p_amount+used+public.payment_refunded(p.id)+public.payment_credit_transferred(p.id)>p.amount_cents then raise exception 'Amount exceeds retained payment money not assigned to expense recovery';end if;
 if p_amount>i.total_cents then raise exception 'Credit exceeds remaining invoice charges';end if;
 adjustment:=gen_random_uuid();
 insert into public.invoice_adjustments(id,invoice_id,adjustment_date,amount_cents,description) values(adjustment,i.id,p_date,-p_amount,'Account credit: '||left(trim(p_reason),480));
 end if;
 insert into public.customer_credits(id,customer_id,source,payment_id,credit_on,amount_cents,method,reason,reference,adjustment_id,created_by)
 values(p_request,p_customer,p_source,p_payment,p_date,p_amount,p_method,trim(p_reason),nullif(trim(p_reference),''),adjustment,auth.uid());
 return p_request;
end;$$;
create function public.apply_customer_credit(p_request uuid,p_credit uuid,p_invoice uuid,p_amount integer,p_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.customer_credit_applications;c public.customer_credits;i public.invoice_totals;used bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_amount is null or p_amount not between 1 and 100000000 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Enter a positive credit amount and actual application date';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.customer_credit_applications where id=p_request;
 if found then
 if row(prior.credit_id,prior.invoice_id,prior.amount_cents,prior.applied_on) is distinct from row(p_credit,p_invoice,p_amount,p_date) then raise exception 'This application form was already saved. Open a new form';end if;return prior.id;end if;
 select * into c from public.customer_credits where id=p_credit;
 perform 1 from public.customers where id=c.customer_id for update;
 select * into c from public.customer_credits where id=p_credit for update;
 perform 1 from public.invoices where id=p_invoice for update;
 select * into i from public.invoice_totals where id=p_invoice;
 if c.id is null or c.reversed_at is not null or i.id is null or i.status<>'issued' or i.customer_id<>c.customer_id then raise exception 'Choose available credit and a finalized invoice for the same customer';end if;
 if p_date<c.credit_on or p_date<i.issue_date then raise exception 'Application date cannot precede the credit or invoice';end if;
 select coalesce(sum(amount_cents),0) into used from public.customer_credit_applications where credit_id=c.id and reversed_at is null;
 if used+p_amount>c.amount_cents or p_amount>i.balance_cents then raise exception 'Amount exceeds available credit or the invoice balance';end if;
 insert into public.customer_credit_applications(id,credit_id,invoice_id,applied_on,amount_cents,created_by) values(p_request,c.id,i.id,p_date,p_amount,auth.uid());
 return p_request;
end;$$;
create function public.reverse_customer_credit(p_id uuid,p_application boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.customer_credits;a public.customer_credit_applications;p public.invoice_payments;adjustment uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_application is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a correction reason';end if;
 if p_application then
 select * into a from public.customer_credit_applications where id=p_id;
 select * into c from public.customer_credits where id=a.credit_id;
 else select * into c from public.customer_credits where id=p_id;end if;
 if c.id is null then raise exception 'Credit record not found';end if;
 perform 1 from public.customers where id=c.customer_id for update;
 if p_application then
 perform 1 from public.invoices where id=a.invoice_id for update;
 select * into a from public.customer_credit_applications where id=p_id for update;
 if a.reversed_at is not null then return;end if;
 update public.customer_credit_applications set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=trim(p_reason) where id=a.id;
 else
 select * into c from public.customer_credits where id=p_id for update;
 if c.reversed_at is not null then return;end if;
 if exists(select 1 from public.customer_credit_applications where credit_id=c.id and reversed_at is null) then raise exception 'Reverse this credit’s applications before correcting its source';end if;
 if c.source='invoice' then
 select * into p from public.invoice_payments where id=c.payment_id;
 perform 1 from public.invoices where id=p.invoice_id for update;
 if (select total_cents from public.invoice_totals where id=p.invoice_id)+c.amount_cents>1000000000 then raise exception 'Restoring these charges would exceed the invoice limit. Correct later adjustments first';end if;
 adjustment:=gen_random_uuid();
 insert into public.invoice_adjustments(id,invoice_id,adjustment_date,amount_cents,description) values(adjustment,p.invoice_id,c.credit_on,c.amount_cents,'Reverse account credit: '||left(c.reason,470));
 end if;
 update public.customer_credits set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=trim(p_reason),reverse_adjustment_id=adjustment where id=c.id;
 end if;
end;$$;
-- Existing financial editors must never reuse money held as customer credit.
create function public.guard_customer_credit_sources() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='invoice_payments' then
 if public.payment_credit_transferred(old.id)>0 and row(new.reversed_at,new.amount_cents,new.invoice_id,new.paid_on) is distinct from row(old.reversed_at,old.amount_cents,old.invoice_id,old.paid_on) then raise exception 'Correct active account credits before changing their source payment';end if;
 elsif new.status='void' and old.status<>'void' and exists(select 1 from public.customer_credit_applications where invoice_id=old.id and reversed_at is null) then raise exception 'Reverse applied account credits before voiding this invoice';end if;
 return new;
end;$$;
create trigger customer_credit_payment_guard before update on public.invoice_payments for each row execute function public.guard_customer_credit_sources();
create trigger customer_credit_invoice_guard before update on public.invoices for each row execute function public.guard_customer_credit_sources();
revoke all on function public.guard_customer_credit_sources() from public,anon,authenticated;
create or replace function public.record_invoice_refund(p_request uuid,p_payment uuid,p_amount integer,p_date date,p_effect text,p_method text,p_reason text,p_reference text default null,p_notes text default null) returns uuid
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
 if p_amount+(public.payment_refunded(p.id)+public.payment_credit_transferred(p.id))>p.amount_cents then raise exception 'Refund exceeds the amount still retained from this payment';end if;
 if used+p_amount+(public.payment_refunded(p.id)+public.payment_credit_transferred(p.id))>p.amount_cents then raise exception 'Reduce or clear this payment’s expense-recovery assignments before refunding the assigned money';end if;
 if p_effect='reduce' then
 adjustment:=gen_random_uuid();
 insert into public.invoice_adjustments(id,invoice_id,adjustment_date,amount_cents,description) values(adjustment,i.id,p_date,-p_amount,'Refund: '||left(trim(p_reason),492));
 end if;
 insert into public.invoice_refunds(id,invoice_id,payment_id,refunded_on,amount_cents,effect,method,reason,reference,notes,adjustment_id,created_by)
 values(p_request,i.id,p.id,p_date,p_amount,p_effect,p_method,trim(p_reason),nullif(trim(p_reference),''),nullif(trim(p_notes),''),adjustment,auth.uid());
 return p_request;
end;$$;
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
 if used+p_cents>p.amount_cents-(public.payment_refunded(p.id)+public.payment_credit_transferred(p.id)) then raise exception 'Amount exceeds the unassigned part of this payment';end if;
 if recovered+p_cents>cap or all_recovered+p_cents>e.amount_cents then raise exception 'Amount exceeds the linked original expense cost still unrecovered';end if;
 update public.expense_payment_assignments set retired_at=now(),retired_by=auth.uid(),retired_reason='Replaced: '||trim(p_reason) where id=p_current;
 insert into public.expense_payment_assignments(id,payment_id,expense_id,amount_cents,reason,created_by) values(p_request,p.id,e.id,p_cents,trim(p_reason),auth.uid());return p_request;
end;$$;
create or replace function public.invoice_expense_recovery(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 return jsonb_build_object('payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'paid_on',p.paid_on,'amount_cents',p.amount_cents,'available_cents',p.amount_cents-(public.payment_refunded(p.id)+public.payment_credit_transferred(p.id))-coalesce((select sum(a.amount_cents) from public.expense_payment_assignments a where a.payment_id=p.id and a.retired_at is null),0)) order by p.paid_on,p.id) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where p.invoice_id=p_invoice and p.reversed_at is null and i.status='issued'),'[]'),
 'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'vendor',e.vendor,'expense_date',e.expense_date,'cost_cents',public.expense_invoice_cost(e.id,p_invoice))) from public.expenses e where e.voided_at is null and public.expense_invoice_cost(e.id,p_invoice)>0),'[]'),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('vendor',e.vendor,'counted',a.retired_at is null and p.reversed_at is null and i.status='issued' and e.voided_at is null) order by a.created_at desc,a.id) from public.expense_payment_assignments a join public.invoice_payments p on p.id=a.payment_id join public.invoices i on i.id=p.invoice_id join public.expenses e on e.id=a.expense_id where p.invoice_id=p_invoice),'[]'));
end;$$;
create or replace function public.invoice_refund_overview(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid refund page';end if;
 select jsonb_build_object('total',(select count(*) from public.invoice_refunds where invoice_id=p_invoice),
 'refunded_cents',(select coalesce(sum(amount_cents),0) from public.invoice_refunds where invoice_id=p_invoice and reversed_at is null),
 'rows',coalesce((select jsonb_agg(x order by created_at desc,id) from (select r.*,p.paid_on as original_paid_on from public.invoice_refunds r join public.invoice_payments p on p.id=r.payment_id where r.invoice_id=p_invoice order by r.created_at desc,r.id limit 25 offset (p_page-1)*25) x),'[]'),
 'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select p.id,p.paid_on,p.amount_cents,p.method,public.payment_refunded(p.id) as refunded_cents,
 p.amount_cents-(public.payment_refunded(p.id)+public.payment_credit_transferred(p.id))-coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0) as available_cents
 from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where p.invoice_id=p_invoice and p.reversed_at is null and i.status='issued' and p.amount_cents-(public.payment_refunded(p.id)+public.payment_credit_transferred(p.id))-coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0)>0 order by p.paid_on,p.id limit 100) x),'[]')) into result;
 return result;
end;$$;

revoke all on function public.record_customer_credit(uuid,uuid,text,uuid,integer,date,text,text,text),public.apply_customer_credit(uuid,uuid,uuid,integer,date),public.reverse_customer_credit(uuid,boolean,text) from public,anon;
grant execute on function public.record_customer_credit(uuid,uuid,text,uuid,integer,date,text,text,text),public.apply_customer_credit(uuid,uuid,uuid,integer,date),public.reverse_customer_credit(uuid,boolean,text) to authenticated;
alter function public.cash_report(date,date) rename to cash_report_before_account_credit;
revoke all on function public.cash_report_before_account_credit(date,date) from public,anon,authenticated;
create function public.cash_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;extra bigint;months jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 result:=public.cash_report_before_account_credit(p_from,p_to);
 select coalesce(sum(amount_cents),0) into extra from public.customer_credits where source='advance' and reversed_at is null and credit_on between p_from and p_to;
 select coalesce(jsonb_agg(m||jsonb_build_object('received_cents',(m->>'received_cents')::bigint+x.n,'net_cents',(m->>'received_cents')::bigint-(m->>'spent_cents')::bigint+(m->>'supplier_refunds_cents')::bigint-(m->>'customer_refunds_cents')::bigint+x.n) order by m->>'month'),'[]') into months
 from jsonb_array_elements(result->'months') m cross join lateral (select coalesce(sum(amount_cents),0)::bigint n from public.customer_credits where source='advance' and reversed_at is null and credit_on between p_from and p_to and to_char(credit_on,'YYYY-MM')=m->>'month') x;
 return result||jsonb_build_object('received_cents',(result->>'received_cents')::bigint+extra,'net_cents',(result->>'net_cents')::bigint+extra,'advance_receipts_cents',extra,'months',months);
end;$$;
revoke all on function public.cash_report(date,date) from public,anon;
grant execute on function public.cash_report(date,date) to authenticated;

create or replace function public.cash_ledger_export(p_from date,p_to date) returns jsonb
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
  select c.credit_on,'advance',c.id,null::uuid,u.name,null::text,null::text,c.method,c.reference,c.amount_cents::bigint,0::bigint,0::bigint,0::bigint
  from public.customer_credits c join public.customers u on u.id=c.customer_id where c.source='advance' and c.reversed_at is null and c.credit_on between p_from and p_to
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
   'received_cents',coalesce(sum(cash_in_cents) filter(where kind in ('payment','advance')),0),
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
create function public.invoice_credit_public_history(p_invoice uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by event_date,id),'[]') from (
 select a.id,a.applied_on event_date,a.amount_cents,'applied'::text kind,(a.reversed_at is not null) reversed from public.customer_credit_applications a where a.invoice_id=p_invoice
 union all select c.id,c.credit_on,c.amount_cents,'transferred',(c.reversed_at is not null) from public.customer_credits c join public.invoice_payments p on p.id=c.payment_id where p.invoice_id=p_invoice) x
$$;
revoke all on function public.invoice_credit_public_history(uuid) from public,anon,authenticated;
create function public.admin_invoice_credit_history(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;return public.invoice_credit_public_history(p_invoice);end;$$;
revoke all on function public.admin_invoice_credit_history(uuid) from public,anon;
grant execute on function public.admin_invoice_credit_history(uuid) to authenticated;
create or replace function public.portal_invoice(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();i public.invoice_totals;result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select * into i from public.invoice_totals where id=p_invoice and customer_id=customer and status in ('issued','void');
  if not found then return null; end if;
  result:=jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'issue_date',i.issue_date,'due_date',i.due_date,'period_from',i.period_from,'period_to',i.period_to,'status',i.status,
    'customer',i.customer_snapshot,'business',i.business_snapshot,'notes',i.notes,'base_cents',i.base_cents,'adjustment_cents',i.adjustment_cents,'total_cents',i.total_cents,'gross_paid_cents',i.gross_paid_cents,'refunded_cents',i.refunded_cents,'paid_cents',i.paid_cents,'balance_cents',i.balance_cents,
    'lines',public.invoice_display_lines(i.id,coalesce(i.customer_snapshot->>'invoice_presentation','itemized')='combined_services'),
    'applied_credit_cents',i.applied_credit_cents,'transferred_credit_cents',i.transferred_credit_cents,
    'account_credits',public.invoice_credit_public_history(i.id),
    'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select id,paid_on,amount_cents,method,(reversed_at is not null) as reversed from public.invoice_payments where invoice_id=i.id) x),'[]'),
    'refunds',coalesce((select jsonb_agg(x order by refunded_on,id) from (select id,refunded_on,amount_cents,method,effect,reason,reference,(reversed_at is not null) as reversed from public.invoice_refunds where invoice_id=i.id) x),'[]'),
    'adjustments',coalesce((select jsonb_agg(x order by adjustment_date,id) from (select id,adjustment_date,description,amount_cents from public.invoice_adjustments where invoice_id=i.id) x),'[]'));
  return result;
end $$;
create function public.customer_credit_overview(p_customer uuid,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid credit history page';end if;
 return jsonb_build_object(
 'available_cents',(select coalesce(sum(c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)),0) from public.customer_credits c where c.customer_id=p_customer and c.reversed_at is null),
 'credit_count',(select count(*) from public.customer_credits where customer_id=p_customer),
 'application_count',(select count(*) from public.customer_credit_applications a join public.customer_credits c on c.id=a.credit_id where c.customer_id=p_customer),
 'credits',coalesce((select jsonb_agg(x order by created_at desc,id) from (select c.*,p.invoice_id,(select invoice_number from public.invoices where id=p.invoice_id) invoice_number,c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0) available_cents from public.customer_credits c left join public.invoice_payments p on p.id=c.payment_id where c.customer_id=p_customer order by c.created_at desc,c.id limit 25 offset(p_page-1)*25) x),'[]'),
 'applications',coalesce((select jsonb_agg(x order by created_at desc,id) from (select a.*,i.invoice_number from public.customer_credit_applications a join public.customer_credits c on c.id=a.credit_id join public.invoices i on i.id=a.invoice_id where c.customer_id=p_customer order by a.created_at desc,a.id limit 25 offset(p_page-1)*25) x),'[]'),
 'available',coalesce((select jsonb_agg(x order by credit_on,id) from (select c.id,c.credit_on,c.reason,c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0) available_cents from public.customer_credits c where c.customer_id=p_customer and c.reversed_at is null and c.amount_cents>coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0) order by c.credit_on,c.id limit 100) x),'[]'),
 'invoices',coalesce((select jsonb_agg(x order by due_date,id) from (select id,invoice_number,issue_date,due_date,balance_cents from public.invoice_totals where customer_id=p_customer and status='issued' and balance_cents>0 order by due_date,id limit 100) x),'[]'),
 'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select p.id,p.paid_on,i.invoice_number,p.amount_cents-public.payment_refunded(p.id)-public.payment_credit_transferred(p.id)-coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0) available_cents from public.invoice_payments p join public.invoice_totals i on i.id=p.invoice_id where i.customer_id=p_customer and i.status='issued' and i.balance_cents=0 and i.total_cents>0 and p.reversed_at is null and p.amount_cents>public.payment_refunded(p.id)+public.payment_credit_transferred(p.id)+coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0) order by p.paid_on,p.id limit 100) x),'[]'));
end;$$;
revoke all on function public.customer_credit_overview(uuid,integer) from public,anon;
grant execute on function public.customer_credit_overview(uuid,integer) to authenticated;
create or replace view public.reporting_receipts with(security_invoker=true) as
select p.id as payment_id,p.invoice_id,p.paid_on,p.amount_cents,coalesce(s.horse_id,l.horse_id) as horse_id,coalesce(i.stay_id,l.stay_id) as stay_id
from public.invoice_payments p join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and p.reversed_at is null
union all
select r.id,r.invoice_id,r.refunded_on,-r.amount_cents,coalesce(s.horse_id,l.horse_id),coalesce(i.stay_id,l.stay_id)
from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and r.reversed_at is null
union all select id,null::uuid,credit_on,amount_cents,null::uuid,null::uuid from public.customer_credits where source='advance' and reversed_at is null;
create function public.portal_account_credit() returns bigint language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result bigint;
begin
 if customer is null then raise exception 'Customer portal access required';end if;
 select coalesce(sum(c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)),0)::bigint into result from public.customer_credits c where c.customer_id=customer and c.reversed_at is null;
 return result;
end;$$;
revoke all on function public.portal_account_credit() from public,anon;
grant execute on function public.portal_account_credit() to authenticated;
commit;
