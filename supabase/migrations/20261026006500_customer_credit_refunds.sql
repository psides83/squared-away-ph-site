begin;
create table public.customer_credit_refunds (
 id uuid primary key,credit_id uuid not null references public.customer_credits(id),
 refunded_on date not null,amount_cents integer not null check(amount_cents between 1 and 100000000),
 method text not null check(method in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other')),
 reason text not null check(length(trim(reason)) between 1 and 500),reference text check(length(reference)<=200),notes text check(length(notes)<=2000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 reversed_at timestamptz,reversed_by uuid references auth.users(id),reversal_reason text
);
create index customer_credit_refunds_credit on public.customer_credit_refunds(credit_id,created_at desc,id);
alter table public.customer_credit_refunds enable row level security;
revoke all on public.customer_credit_refunds from public,anon,authenticated;
grant select on public.customer_credit_refunds to authenticated;
create policy admin_read on public.customer_credit_refunds for select to authenticated using((select public.is_admin()));
create function public.credit_refunded(p_credit uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount_cents),0)::bigint from public.customer_credit_refunds where credit_id=p_credit and reversed_at is null
$$;
revoke all on function public.credit_refunded(uuid) from public,anon,authenticated;
create function public.record_customer_credit_refund(p_request uuid,p_credit uuid,p_amount integer,p_date date,p_method text,p_reason text,p_reference text default null,p_notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.customer_credit_refunds;c public.customer_credits;used bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_credit is null or p_amount is null or p_amount not between 1 and 100000000 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_method is null or p_method not in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other') or p_reason is null or length(trim(p_reason)) not between 1 and 500 or length(p_reference)>200 or length(p_notes)>2000 then raise exception 'Enter the positive amount already returned, actual date, method and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.customer_credit_refunds where id=p_request;
 if found then
 if row(prior.credit_id,prior.amount_cents,prior.refunded_on,prior.method,prior.reason,prior.reference,prior.notes) is distinct from row(p_credit,p_amount,p_date,p_method,trim(p_reason),nullif(trim(p_reference),''),nullif(trim(p_notes),'')) then raise exception 'This refund form was already saved. Open a new form';end if;
 return prior.id;end if;
 select * into c from public.customer_credits where id=p_credit;
 perform 1 from public.customers where id=c.customer_id for update;
 select * into c from public.customer_credits where id=p_credit for update;
 if c.id is null or c.reversed_at is not null then raise exception 'Choose an active customer credit';end if;
 if p_date<c.credit_on then raise exception 'Refund date cannot precede the source credit';end if;
 select coalesce(sum(amount_cents),0) into used from public.customer_credit_applications where credit_id=c.id and reversed_at is null;
 if p_amount+used+public.credit_refunded(c.id)>c.amount_cents then raise exception 'Refund exceeds unused credit. Correct earlier applications or refunds before returning more';end if;
 insert into public.customer_credit_refunds(id,credit_id,refunded_on,amount_cents,method,reason,reference,notes,created_by)
 values(p_request,c.id,p_date,p_amount,p_method,trim(p_reason),nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
 return p_request;
end;$$;
create function public.reverse_customer_credit_refund(p_refund uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare r public.customer_credit_refunds;customer uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a correction reason';end if;
 select * into r from public.customer_credit_refunds where id=p_refund;
 if not found then raise exception 'Credit refund not found';end if;
 select customer_id into customer from public.customer_credits where id=r.credit_id;
 perform 1 from public.customers where id=customer for update;
 perform 1 from public.customer_credits where id=r.credit_id for update;
 select * into r from public.customer_credit_refunds where id=p_refund for update;
 if r.reversed_at is not null then return;end if;
 update public.customer_credit_refunds set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=trim(p_reason) where id=r.id;
end;$$;
create function public.guard_refunded_credit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reversed_at is not null and old.reversed_at is null and public.credit_refunded(old.id)>0 then raise exception 'Correct active account-credit refund records before reversing their source credit';end if;
 return new;
end;$$;
create trigger refunded_credit_guard before update on public.customer_credits for each row execute function public.guard_refunded_credit();
revoke all on function public.guard_refunded_credit() from public,anon,authenticated;
revoke all on function public.record_customer_credit_refund(uuid,uuid,integer,date,text,text,text,text),public.reverse_customer_credit_refund(uuid,text) from public,anon;
grant execute on function public.record_customer_credit_refund(uuid,uuid,integer,date,text,text,text,text),public.reverse_customer_credit_refund(uuid,text) to authenticated;
create or replace function public.apply_customer_credit(p_request uuid,p_credit uuid,p_invoice uuid,p_amount integer,p_date date) returns uuid
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
 if used+p_amount+public.credit_refunded(c.id)>c.amount_cents or p_amount>i.balance_cents then raise exception 'Amount exceeds available credit or the invoice balance';end if;
 insert into public.customer_credit_applications(id,credit_id,invoice_id,applied_on,amount_cents,created_by) values(p_request,c.id,i.id,p_date,p_amount,auth.uid());
 return p_request;
end;$$;
create or replace function public.customer_credit_overview(p_customer uuid,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid credit history page';end if;
 return jsonb_build_object(
 'available_cents',(select coalesce(sum(c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)-public.credit_refunded(c.id)),0) from public.customer_credits c where c.customer_id=p_customer and c.reversed_at is null),
 'credit_count',(select count(*) from public.customer_credits where customer_id=p_customer),
 'application_count',(select count(*) from public.customer_credit_applications a join public.customer_credits c on c.id=a.credit_id where c.customer_id=p_customer),
 'credits',coalesce((select jsonb_agg(x order by created_at desc,id) from (select c.*,p.invoice_id,(select invoice_number from public.invoices where id=p.invoice_id) invoice_number,c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)-public.credit_refunded(c.id) available_cents from public.customer_credits c left join public.invoice_payments p on p.id=c.payment_id where c.customer_id=p_customer order by c.created_at desc,c.id limit 25 offset(p_page-1)*25) x),'[]'),
 'applications',coalesce((select jsonb_agg(x order by created_at desc,id) from (select a.*,i.invoice_number from public.customer_credit_applications a join public.customer_credits c on c.id=a.credit_id join public.invoices i on i.id=a.invoice_id where c.customer_id=p_customer order by a.created_at desc,a.id limit 25 offset(p_page-1)*25) x),'[]'),
 'available',coalesce((select jsonb_agg(x order by credit_on,id) from (select c.id,c.credit_on,c.reason,c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)-public.credit_refunded(c.id) available_cents from public.customer_credits c where c.customer_id=p_customer and c.reversed_at is null and c.amount_cents>coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)+public.credit_refunded(c.id) order by c.credit_on,c.id limit 100) x),'[]'),
 'invoices',coalesce((select jsonb_agg(x order by due_date,id) from (select id,invoice_number,issue_date,due_date,balance_cents from public.invoice_totals where customer_id=p_customer and status='issued' and balance_cents>0 order by due_date,id limit 100) x),'[]'),
 'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select p.id,p.paid_on,i.invoice_number,p.amount_cents-public.payment_refunded(p.id)-public.payment_credit_transferred(p.id)-coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0) available_cents from public.invoice_payments p join public.invoice_totals i on i.id=p.invoice_id where i.customer_id=p_customer and i.status='issued' and i.balance_cents=0 and i.total_cents>0 and p.reversed_at is null and p.amount_cents>public.payment_refunded(p.id)+public.payment_credit_transferred(p.id)+coalesce((select sum(amount_cents) from public.expense_payment_assignments where payment_id=p.id and retired_at is null),0) order by p.paid_on,p.id limit 100) x),'[]'));
end;$$;
create or replace function public.portal_account_credit() returns bigint language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result bigint;
begin
 if customer is null then raise exception 'Customer portal access required';end if;
 select coalesce(sum(c.amount_cents-coalesce((select sum(a.amount_cents) from public.customer_credit_applications a where a.credit_id=c.id and a.reversed_at is null),0)-public.credit_refunded(c.id)),0)::bigint into result from public.customer_credits c where c.customer_id=customer and c.reversed_at is null;
 return result;
end;$$;

create function public.customer_credit_refund_overview(p_customer uuid,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid refund history page';end if;
 return jsonb_build_object('count',(select count(*) from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id where c.customer_id=p_customer),
 'refunded_cents',(select coalesce(sum(r.amount_cents),0) from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id where c.customer_id=p_customer and r.reversed_at is null),
 'rows',coalesce((select jsonb_agg(x order by created_at desc,id) from (select r.*,c.credit_on,c.source from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id where c.customer_id=p_customer order by r.created_at desc,r.id limit 25 offset(p_page-1)*25) x),'[]'));
end;$$;
create function public.portal_credit_refunds(p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();
begin
 if customer is null then raise exception 'Customer portal access required';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid refund history page';end if;
 return jsonb_build_object('count',(select count(*) from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id where c.customer_id=customer),
 'refunded_cents',(select coalesce(sum(r.amount_cents),0) from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id where c.customer_id=customer and r.reversed_at is null),
 'rows',coalesce((select jsonb_agg(x order by refunded_on desc,id) from (select r.id,r.refunded_on,r.amount_cents,r.method,r.reason,r.reference,(r.reversed_at is not null) reversed from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id where c.customer_id=customer order by r.refunded_on desc,r.id limit 25 offset(p_page-1)*25) x),'[]'));
end;$$;
revoke all on function public.customer_credit_refund_overview(uuid,integer),public.portal_credit_refunds(integer) from public,anon;
grant execute on function public.customer_credit_refund_overview(uuid,integer),public.portal_credit_refunds(integer) to authenticated;
-- Separate cash events; a refund never reopens an invoice or creates another adjustment.
alter function public.cash_report(date,date) rename to cash_report_before_credit_refunds;
revoke all on function public.cash_report_before_credit_refunds(date,date) from public,anon,authenticated;
create function public.cash_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;extra bigint;months jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 result:=public.cash_report_before_credit_refunds(p_from,p_to);
 select coalesce(sum(amount_cents),0) into extra from public.customer_credit_refunds where reversed_at is null and refunded_on between p_from and p_to;
 select coalesce(jsonb_agg(m||jsonb_build_object('customer_refunds_cents',(m->>'customer_refunds_cents')::bigint+x.n,'net_cents',(m->>'received_cents')::bigint-(m->>'spent_cents')::bigint+(m->>'supplier_refunds_cents')::bigint-(m->>'customer_refunds_cents')::bigint-x.n) order by m->>'month'),'[]') into months
 from jsonb_array_elements(result->'months') m cross join lateral (select coalesce(sum(amount_cents),0)::bigint n from public.customer_credit_refunds where reversed_at is null and refunded_on between p_from and p_to and to_char(refunded_on,'YYYY-MM')=m->>'month') x;
 return result||jsonb_build_object('customer_refunds_cents',(result->>'customer_refunds_cents')::bigint+extra,'net_cents',(result->>'net_cents')::bigint-extra,'credit_refunds_cents',extra,'months',months);
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
  select r.refunded_on,'credit_refund',r.id,r.credit_id,u.name,null::text,null::text,r.method,r.reference,
   0::bigint,r.amount_cents::bigint,0::bigint,0::bigint
  from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id join public.customers u on u.id=c.customer_id
  where r.reversed_at is null and r.refunded_on between p_from and p_to
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
   'customer_refunds_cents',coalesce(sum(cash_out_cents) filter(where kind in ('customer_refund','credit_refund')),0),
   'supplier_credit_used_cents',coalesce(sum(credit_cents),0),
   'net_cents',coalesce(sum(cash_in_cents-cash_out_cents),0)
  )) into result from bounded b;
 if (result->>'row_count')::integer>10000 then raise exception 'This export exceeds 10,000 entries. Choose a shorter reporting period';end if;
 return result;
end;$$;
revoke all on function public.cash_ledger_export(date,date) from public,anon;
grant execute on function public.cash_ledger_export(date,date) to authenticated;
create or replace view public.reporting_receipts with(security_invoker=true) as
select p.id as payment_id,p.invoice_id,p.paid_on,p.amount_cents,coalesce(s.horse_id,l.horse_id) as horse_id,coalesce(i.stay_id,l.stay_id) as stay_id
from public.invoice_payments p join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and p.reversed_at is null
union all
select r.id,r.invoice_id,r.refunded_on,-r.amount_cents,coalesce(s.horse_id,l.horse_id),coalesce(i.stay_id,l.stay_id)
from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and r.reversed_at is null
union all select id,null::uuid,credit_on,amount_cents,null::uuid,null::uuid from public.customer_credits where source='advance' and reversed_at is null
union all select r.id,p.invoice_id,r.refunded_on,-r.amount_cents,coalesce(s.horse_id,l.horse_id),coalesce(i.stay_id,l.stay_id)
from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id left join public.invoice_payments p on p.id=c.payment_id left join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null
where r.reversed_at is null;
commit;
