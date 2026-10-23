begin;
create function public.supplier_vendor_key(p_vendor text) returns text language sql immutable set search_path='' as $$select lower(trim(regexp_replace(p_vendor,'\s+',' ','g')))$$;
create table public.supplier_credits(
 id uuid primary key,vendor text not null check(length(trim(vendor)) between 1 and 200),
 vendor_key text generated always as(public.supplier_vendor_key(vendor)) stored check(vendor_key<>''),
 return_id uuid references public.supplier_returns(id),issued_on date not null,amount_cents integer not null check(amount_cents between 1 and 100000000),reference text,reason text not null check(length(trim(reason)) between 1 and 2000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancel_reason text
);
create table public.supplier_credit_applications(
 id uuid primary key,credit_id uuid not null references public.supplier_credits(id),expense_id uuid not null references public.expenses(id),amount_cents integer not null check(amount_cents between 1 and 100000000),applied_on date not null,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),reversed_at timestamptz,reversed_by uuid references auth.users(id),reverse_reason text
);
create index supplier_credit_vendor on public.supplier_credits(vendor_key,issued_on);
create index supplier_credit_expense on public.supplier_credit_applications(expense_id);
create index supplier_credit_source on public.supplier_credit_applications(credit_id);
do $$declare t text;begin foreach t in array array['supplier_credits','supplier_credit_applications'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
end loop;end $$;
create function public.supplier_credit_used(p_expense uuid) returns bigint language sql stable security definer set search_path='' as $$select coalesce(sum(amount_cents),0)::bigint from public.supplier_credit_applications where expense_id=p_expense and reversed_at is null$$;
revoke all on function public.supplier_credit_used(uuid) from public,anon,authenticated;
create function public.issue_supplier_credit(p_request uuid,p_vendor text,p_date date,p_amount integer,p_reference text,p_reason text,p_return uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.supplier_credits;r public.supplier_returns;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_vendor is null or length(trim(p_vendor)) not between 1 and 200 or public.supplier_vendor_key(p_vendor)='' or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_amount is null or p_amount not between 1 and 100000000 or length(p_reference)>200 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter the supplier, actual issue date, credit amount and reason';end if;
 -- Serialize duplicate request retries without creating a persistent supplier account.
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.supplier_credits where id=p_request;
 if found then
 if row(prior.vendor_key,prior.issued_on,prior.amount_cents,prior.reference,prior.reason,prior.return_id) is distinct from row(public.supplier_vendor_key(p_vendor),p_date,p_amount,nullif(trim(p_reference),''),trim(p_reason),p_return) then raise exception 'This credit form was already used. Open a new form';end if;
 return prior.id;end if;
 if p_return is not null then select * into r from public.supplier_returns where id=p_return for update;
 if not found or r.cancelled_at is not null or public.supplier_vendor_key(r.vendor)<>public.supplier_vendor_key(p_vendor) or p_date<(select movement_date from public.inventory_movements where id=r.movement_id) then raise exception 'Choose an active return from the same supplier';end if;end if;
 insert into public.supplier_credits(id,vendor,issued_on,amount_cents,reference,reason,return_id,created_by) values(p_request,trim(p_vendor),p_date,p_amount,nullif(trim(p_reference),''),trim(p_reason),p_return,auth.uid());return p_request;
end;$$;
create function public.apply_supplier_credit(p_request uuid,p_credit uuid,p_expense uuid,p_amount integer,p_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.supplier_credits;e public.expenses;prior public.supplier_credit_applications;used bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_amount is null or p_amount not between 1 and 100000000 or p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Enter the credit amount actually applied and its date';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.supplier_credit_applications where id=p_request;
 if found then if row(prior.credit_id,prior.expense_id,prior.amount_cents,prior.applied_on) is distinct from row(p_credit,p_expense,p_amount,p_date) then raise exception 'This application form was already used. Open a new form';end if;return prior.id;end if;
 -- Every credit operation takes the credit lock before an expense lock.
 select * into c from public.supplier_credits where id=p_credit for update;
 if not found or c.cancelled_at is not null then raise exception 'Choose an available supplier credit';end if;
 select * into e from public.expenses where id=p_expense for update;
 if not found or e.voided_at is not null or not exists(select 1 from public.inventory_movements where expense_id=e.id and kind='purchase') then raise exception 'Choose an active inventory purchase expense';end if;
 if public.supplier_vendor_key(e.vendor) is distinct from c.vendor_key then raise exception 'The purchase supplier must match the credit supplier';end if;
 if p_date<c.issued_on or p_date<e.expense_date or (e.paid_on is not null and p_date>e.paid_on) then raise exception 'Use a date on or after issue/purchase and no later than the recorded settlement date';end if;
 select coalesce(sum(amount_cents),0) into used from public.supplier_credit_applications where credit_id=c.id and reversed_at is null;
 if used+p_amount>c.amount_cents then raise exception 'The supplier credit has insufficient remaining balance';end if;
 if public.supplier_credit_used(e.id)+p_amount>e.amount_cents then raise exception 'Applied credits would exceed this purchase total';end if;
 insert into public.supplier_credit_applications(id,credit_id,expense_id,amount_cents,applied_on,created_by) values(p_request,c.id,e.id,p_amount,p_date,auth.uid());return p_request;
end;$$;
create function public.reverse_supplier_credit_application(p_application uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.supplier_credit_applications;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a correction reason';end if;
 select * into a from public.supplier_credit_applications where id=p_application;
 if not found then raise exception 'Credit application not found';end if;
 perform 1 from public.supplier_credits where id=a.credit_id for update;perform 1 from public.expenses where id=a.expense_id for update;
 select * into a from public.supplier_credit_applications where id=p_application for update;
 if a.reversed_at is not null then return;end if;
 update public.supplier_credit_applications set reversed_at=now(),reversed_by=auth.uid(),reverse_reason=trim(p_reason) where id=a.id;
end;$$;
create function public.cancel_supplier_credit(p_credit uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.supplier_credits;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a correction reason';end if;
 select * into c from public.supplier_credits where id=p_credit for update;if not found then raise exception 'Supplier credit not found';end if;if c.cancelled_at is not null then return;end if;
 if exists(select 1 from public.supplier_credit_applications where credit_id=c.id and reversed_at is null) then raise exception 'Reverse this credit’s active purchase applications before cancelling it';end if;
 update public.supplier_credits set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason) where id=c.id;
end;$$;
create function public.guard_supplier_credit_expense() returns trigger language plpgsql security definer set search_path='' as $$
declare used bigint;last_date date;
begin
 used:=public.supplier_credit_used(old.id);if used=0 then return new;end if;
 if new.voided_at is not null or new.amount_cents<used or public.supplier_vendor_key(new.vendor) is distinct from public.supplier_vendor_key(old.vendor) then raise exception 'Reverse active supplier-credit applications before voiding, changing supplier or reducing this expense below applied credit';end if;
 select max(applied_on) into last_date from public.supplier_credit_applications where expense_id=old.id and reversed_at is null;
 if (new.paid_on is not null and new.paid_on<last_date) or exists(select 1 from public.supplier_credit_applications where expense_id=old.id and reversed_at is null and applied_on<new.expense_date) then raise exception 'Expense dates must cover the applied supplier credits';end if;return new;
end;$$;
create trigger supplier_credit_expense_guard before update on public.expenses for each row execute function public.guard_supplier_credit_expense();
create function public.guard_supplier_credit_return() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.cancelled_at is not null and old.cancelled_at is null and exists(select 1 from public.supplier_credits where return_id=old.id and cancelled_at is null) then raise exception 'Cancel linked supplier credits before cancelling this return';end if;return new;end;$$;
create trigger supplier_credit_return_guard before update on public.supplier_returns for each row execute function public.guard_supplier_credit_return();
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
  select coalesce(sum(e.amount_cents-public.supplier_credit_used(e.id)),0) into spent from public.expenses e
    where e.voided_at is null and e.paid_on between p_from and p_to;
  select coalesce(sum(amount_cents),0) into refunds from public.supplier_refunds where reversed_at is null and paid_on between p_from and p_to;
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
      (select coalesce(sum(r.amount_cents),0) from public.supplier_refunds r where r.reversed_at is null and r.paid_on between p_from and p_to and date_trunc('month',r.paid_on)=m) as supplier_refunds_cents
    from generate_series(date_trunc('month',p_from),date_trunc('month',p_to),interval '1 month') m
  ) x;
  return jsonb_build_object('supplier_credit_used_cents',(select coalesce(sum(a.amount_cents),0) from public.supplier_credit_applications a join public.expenses e on e.id=a.expense_id where a.reversed_at is null and e.voided_at is null and e.paid_on between p_from and p_to),'received_cents',received,'spent_cents',spent,'supplier_refunds_cents',refunds,'net_cents',received-spent+refunds,
    'outstanding_cents',outstanding,'overdue_cents',overdue,'categories',breakdown,'months',monthly);
end $$;

create function public.supplier_credit_overview(p_page integer default 1,p_credit uuid default null,p_history_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 or p_history_page is null or p_history_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 select jsonb_build_object('total',(select count(*) from public.supplier_credits where p_credit is null or id=p_credit),'available_cents',(select coalesce(sum(c.amount_cents-coalesce(u.used,0)),0) from public.supplier_credits c left join lateral(select sum(amount_cents) used from public.supplier_credit_applications where credit_id=c.id and reversed_at is null) u on true where c.cancelled_at is null),'rows',coalesce(jsonb_agg(to_jsonb(x) order by x.issued_on desc,x.id),'[]')) into result from (
 select c.*,coalesce((select sum(amount_cents) from public.supplier_credit_applications where credit_id=c.id and reversed_at is null),0) used_cents,
 (select count(*) from public.supplier_credit_applications where credit_id=c.id) application_count,
 (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]') from(select a.*,e.expense_date,e.paid_on,e.vendor from public.supplier_credit_applications a join public.expenses e on e.id=a.expense_id where credit_id=c.id and p_credit is not null order by a.created_at desc,a.id limit 20 offset (p_history_page-1)*20) a) applications
 from public.supplier_credits c where p_credit is null or c.id=p_credit order by c.issued_on desc,c.id limit 25 offset (p_page-1)*25
 ) x;return result;
end;$$;
create function public.expense_supplier_credits(p_expense uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.expenses;result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into e from public.expenses where id=p_expense;if not found then raise exception 'Expense not found';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 select jsonb_build_object('applied_cents',public.supplier_credit_used(e.id),'cash_cents',e.amount_cents-public.supplier_credit_used(e.id),
 'eligible',case when e.voided_at is null and exists(select 1 from public.inventory_movements where expense_id=e.id and kind='purchase') then (select coalesce(jsonb_agg(to_jsonb(c) order by c.issued_on,c.id),'[]') from(select c.id,c.vendor,c.reference,c.issued_on,c.amount_cents-(select coalesce(sum(amount_cents),0) from public.supplier_credit_applications where credit_id=c.id and reversed_at is null) available_cents from public.supplier_credits c where c.cancelled_at is null and c.vendor_key=public.supplier_vendor_key(e.vendor) and c.issued_on<=coalesce(e.paid_on,(now() at time zone 'America/Chicago')::date) and c.amount_cents>(select coalesce(sum(amount_cents),0) from public.supplier_credit_applications where credit_id=c.id and reversed_at is null) order by c.issued_on,c.id limit 100) c where c.available_cents>0) else '[]'::jsonb end,
 'application_count',(select count(*) from public.supplier_credit_applications where expense_id=e.id),
 'applications',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]') from(select a.*,c.vendor,c.reference from public.supplier_credit_applications a join public.supplier_credits c on c.id=a.credit_id where a.expense_id=e.id order by a.created_at desc,a.id limit 20 offset (p_page-1)*20) a)) into result;return result;
end;$$;
revoke all on function public.issue_supplier_credit(uuid,text,date,integer,text,text,uuid),public.apply_supplier_credit(uuid,uuid,uuid,integer,date),public.reverse_supplier_credit_application(uuid,text),public.cancel_supplier_credit(uuid,text),public.supplier_credit_overview(integer,uuid,integer),public.expense_supplier_credits(uuid,integer) from public,anon;
grant execute on function public.issue_supplier_credit(uuid,text,date,integer,text,text,uuid),public.apply_supplier_credit(uuid,uuid,uuid,integer,date),public.reverse_supplier_credit_application(uuid,text),public.cancel_supplier_credit(uuid,text),public.supplier_credit_overview(integer,uuid,integer),public.expense_supplier_credits(uuid,integer) to authenticated;
create or replace function public.supplier_return_overview(p_page integer default 1,p_return uuid default null,p_refund_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 or p_refund_page is null or p_refund_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with page as (
 select r.*,m.product_id,p.name as product_name,m.entered_quantity as quantity,m.unit_label,m.movement_date as returned_on,-m.value_delta_cents as stock_cost_cents,
 (select coalesce(sum(amount_cents),0) from public.supplier_refunds where return_id=r.id and reversed_at is null) as refunded_cents,
 (select coalesce(sum(amount_cents),0) from public.supplier_credits where return_id=r.id and cancelled_at is null) as supplier_credit_cents,
 (select count(*) from public.supplier_credits where return_id=r.id and cancelled_at is null) as supplier_credit_count,
 (select count(*) from public.supplier_refunds where return_id=r.id) as refund_count,
 (select coalesce(jsonb_agg(f order by f.created_at desc,f.id),'[]') from (select id,amount_cents,paid_on,reference,notes,reversed_at,reverse_reason,created_at from public.supplier_refunds where return_id=r.id order by created_at desc,id limit 20 offset (p_refund_page-1)*20) f) as refunds
 from public.supplier_returns r join public.inventory_movements m on m.id=r.movement_id join public.inventory_products p on p.id=m.product_id
 where p_return is null or r.id=p_return
 order by r.created_at desc,r.id limit 25 offset (p_page-1)*25
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by created_at desc,id) from page),'[]'),'total',(select count(*) from public.supplier_returns where p_return is null or id=p_return)) into result;
 return result;
end;$$;
commit;
