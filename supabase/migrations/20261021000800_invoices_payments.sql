begin;

create sequence public.invoice_number_seq start 1001;
revoke all on sequence public.invoice_number_seq from public,anon,authenticated;
create table public.invoices (
  id uuid primary key, invoice_number bigint unique,
  status text not null default 'draft' check(status in ('draft','issued','void')),
  customer_id uuid not null references public.customers(id), stay_id uuid references public.training_stays(id),
  issue_date date not null, due_date date not null check(due_date>=issue_date),
  period_from date, period_to date, check((period_from is null and period_to is null) or (period_from is not null and period_to is not null and period_to>=period_from)),
  notes text check(length(notes)<=5000), customer_snapshot jsonb, business_snapshot jsonb,
  issued_total_cents integer check(issued_total_cents between 0 and 1000000000), issued_at timestamptz,
  void_reason text, voided_at timestamptz, created_at timestamptz not null default now()
);
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id),
  description text not null check(length(trim(description)) between 1 and 500),
  amount_cents integer not null check(amount_cents between -100000000 and 100000000),
  kind text not null check(kind in ('manual','training','expense')), source_snapshot jsonb,
  created_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create table public.invoice_expense_claims (
  expense_id uuid primary key references public.expenses(id), line_id uuid not null unique references public.invoice_lines(id) on delete cascade
);
create table public.invoice_day_claims (
  stay_id uuid not null, day date not null, line_id uuid not null references public.invoice_lines(id) on delete cascade,
  primary key(stay_id,day), foreign key(stay_id,day) references public.training_days(stay_id,day) on delete restrict
);
create index invoice_day_claims_line_idx on public.invoice_day_claims(line_id);
create table public.invoice_payments (
  id uuid primary key, invoice_id uuid not null references public.invoices(id), paid_on date not null,
  amount_cents integer not null check(amount_cents between 1 and 100000000),
  method text not null check(method in ('cash','check','venmo','apple_cash','paypal','bank_transfer','other')),
  reference text check(length(reference)<=200), notes text check(length(notes)<=2000),
  reversed_at timestamptz, reversal_reason text, created_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments(invoice_id);
create table public.invoice_adjustments (
  id uuid primary key, invoice_id uuid not null references public.invoices(id), adjustment_date date not null,
  amount_cents integer not null check(amount_cents between -100000000 and 100000000 and amount_cents<>0),
  description text not null check(length(trim(description)) between 1 and 500), created_at timestamptz not null default now()
);
create index invoice_adjustments_invoice_idx on public.invoice_adjustments(invoice_id);
do $$ declare t text; begin
  foreach t in array array['invoices','invoice_lines','invoice_expense_claims','invoice_day_claims','invoice_payments','invoice_adjustments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
  end loop;
end; $$;

create view public.invoice_totals with(security_invoker=true) as
with amounts as (
  select i.*,
    coalesce(i.issued_total_cents,(select coalesce(sum(amount_cents),0) from public.invoice_lines l where l.invoice_id=i.id))::bigint as base_cents,
    (select coalesce(sum(amount_cents),0) from public.invoice_adjustments a where a.invoice_id=i.id)::bigint as adjustment_cents,
    (select coalesce(sum(amount_cents),0) from public.invoice_payments p where p.invoice_id=i.id and reversed_at is null)::bigint as paid_cents
  from public.invoices i
) select amounts.*,base_cents+adjustment_cents as total_cents,base_cents+adjustment_cents-paid_cents as balance_cents from amounts;
revoke all on public.invoice_totals from anon,authenticated;
grant select on public.invoice_totals to authenticated;

create function public.create_invoice(p_request uuid,p_customer uuid,p_stay uuid,p_issue date,p_due date,p_from date,p_to date,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.invoices%rowtype; s public.training_stays%rowtype;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_request is null then raise exception 'Request ID required'; end if;
  if p_stay is not null then
    select * into s from public.training_stays where id=p_stay for share;
    if not found or s.billing_customer_id<>p_customer then raise exception 'The stay must belong to the selected billing customer'; end if;
    if p_from is null or p_to is null then raise exception 'Choose a billing period for this stay'; end if;
  end if;
  insert into public.invoices(id,customer_id,stay_id,issue_date,due_date,period_from,period_to,notes)
    values(p_request,p_customer,p_stay,p_issue,p_due,p_from,p_to,p_notes) on conflict(id) do nothing;
  select * into existing from public.invoices where id=p_request;
  if row(existing.customer_id,existing.stay_id,existing.issue_date,existing.due_date,existing.period_from,existing.period_to,existing.notes)
    is distinct from row(p_customer,p_stay,p_issue,p_due,p_from,p_to,p_notes) then raise exception 'This form was already used. Reload before creating another invoice.'; end if;
  return p_request;
end; $$;

create function public.update_invoice_header(p_invoice uuid,p_issue date,p_due date,p_notes text) returns void
language plpgsql security definer set search_path='' as $$ begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.invoices where id=p_invoice and status='draft' for update;
  if not found then raise exception 'Only a draft invoice can be edited'; end if;
  update public.invoices set issue_date=p_issue,due_date=p_due,notes=p_notes where id=p_invoice;
end; $$;

create function public.add_invoice_line(p_request uuid,p_invoice uuid,p_description text,p_amount integer) returns uuid
language plpgsql security definer set search_path='' as $$ declare existing public.invoice_lines%rowtype; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.invoices where id=p_invoice and status='draft' for update;
  if not found then raise exception 'Only a draft can receive line items'; end if;
  insert into public.invoice_lines(id,invoice_id,description,amount_cents,kind) values(p_request,p_invoice,p_description,p_amount,'manual') on conflict(id) do nothing;
  select * into existing from public.invoice_lines where id=p_request;
  if row(existing.invoice_id,existing.description,existing.amount_cents,existing.kind) is distinct from row(p_invoice,p_description,p_amount,'manual'::text) then raise exception 'This form was already used. Reload for another line.'; end if;
  return p_request;
end; $$;

create function public.add_expense_chargeback(p_invoice uuid,p_expense uuid,p_markup integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; e public.expenses%rowtype; s public.training_stays%rowtype; line uuid; existing uuid;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice and status='draft' for update;
  if not found then raise exception 'Choose a draft invoice'; end if;
  if p_markup is null or p_markup<0 or p_markup>100000000 then raise exception 'Enter a valid nonnegative handling fee'; end if;
  select * into e from public.expenses where id=p_expense and voided_at is null and reimbursable for update;
  if not found then raise exception 'Choose a non-voided expense flagged for charge-back'; end if;
  if inv.stay_id is not null then
    select * into s from public.training_stays where id=inv.stay_id;
    if s.horse_id<>e.horse_id or s.billing_customer_id<>inv.customer_id then raise exception 'Expense horse does not match this training stay'; end if;
    if e.expense_date<s.arrival_date or (s.departure_date is not null and e.expense_date>s.departure_date) then raise exception 'Expense date falls outside this historical stay. Review its responsible customer before using a manual invoice.'; end if;
  elsif not exists(select 1 from public.horse_customers where horse_id=e.horse_id and customer_id=inv.customer_id) then
    raise exception 'Expense must match a horse linked to this customer; use its historical stay for a former owner';
  end if;
  select l.id into existing from public.invoice_expense_claims c join public.invoice_lines l on l.id=c.line_id where c.expense_id=p_expense and l.invoice_id=p_invoice;
  if found then
    if (select amount_cents from public.invoice_lines where id=existing)<>e.amount_cents+p_markup then raise exception 'Expense already added with a different fee. Remove its draft line first.'; end if;
    return existing;
  end if;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot)
    values(p_invoice,'Expense reimbursement: '||coalesce(e.vendor,'provider')||' · '||e.expense_date::text,e.amount_cents+p_markup,'expense',jsonb_build_object('expense_id',e.id,'expense_date',e.expense_date,'original_cost_cents',e.amount_cents,'handling_fee_cents',p_markup,'horse_id',e.horse_id)) returning id into line;
  insert into public.invoice_expense_claims(expense_id,line_id) values(e.id,line);
  return line;
end; $$;

create function public.add_calendar_training(p_invoice uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; s public.training_stays%rowtype; start_day date; end_day date;
  eligible integer; classified integer; billable integer; divisor integer; amount integer; line uuid; dates jsonb;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice and status='draft' for update;
  if not found or inv.stay_id is null then raise exception 'Choose a draft invoice linked to a training stay'; end if;
  select * into s from public.training_stays where id=inv.stay_id for update;
  if s.billing_customer_id<>inv.customer_id then raise exception 'Billing customer changed. Review the stay and create a matching invoice.'; end if;
  if s.proration<>'calendar_days' then raise exception 'This stay uses manual/full-rate billing. Add an explicitly reviewed manual line instead.'; end if;
  if inv.period_from is null or inv.period_to is null or date_trunc('month',inv.period_from)<>date_trunc('month',inv.period_to) then raise exception 'Calendar training requires a period within one calendar month'; end if;
  if inv.period_to>(now() at time zone 'America/Chicago')::date then raise exception 'The period must be elapsed before generating actual training charges'; end if;
  start_day:=greatest(inv.period_from,s.arrival_date);end_day:=least(inv.period_to,coalesce(s.departure_date,inv.period_to));
  if start_day>end_day then raise exception 'The invoice period does not overlap this stay'; end if;
  eligible:=end_day-start_day+1;
  select count(*),count(*) filter(where status in ('worked','rest')) into classified,billable from public.training_days where stay_id=s.id and day between start_day and end_day;
  if classified<>eligible then raise exception 'Classify every elapsed stay day in this period before generating training. Unmarked days cannot be silently charged.'; end if;
  if billable=0 then raise exception 'No worked or billable-rest days in this period'; end if;
  if exists(select 1 from public.invoice_lines where invoice_id=p_invoice and kind='training') then
    raise exception 'This draft already has generated training. Remove that line before regenerating.';
  end if;
  divisor:=extract(day from (date_trunc('month',start_day)+interval '1 month - 1 day'))::integer;
  amount:=round(s.monthly_rate_cents::numeric*billable/divisor)::integer;
  select jsonb_agg(day order by day) into dates from public.training_days where stay_id=s.id and day between start_day and end_day and status in ('worked','rest');
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot)
    values(p_invoice,'Training · '||billable||' billable days / '||divisor||' calendar days',amount,'training',jsonb_build_object('stay_id',s.id,'monthly_rate_cents',s.monthly_rate_cents,'billable_days',billable,'calendar_days',divisor,'period_from',start_day,'period_to',end_day,'dates',dates)) returning id into line;
  insert into public.invoice_day_claims(stay_id,day,line_id)
    select s.id,day,line from public.training_days where stay_id=s.id and day between start_day and end_day and status in ('worked','rest');
  return line;
end; $$;

create function public.remove_invoice_line(p_line uuid) returns void language plpgsql security definer set search_path='' as $$
declare inv_id uuid; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select invoice_id into inv_id from public.invoice_lines where id=p_line;
  perform 1 from public.invoices where id=inv_id and status='draft' for update;
  if not found then raise exception 'Only draft lines can be removed'; end if;
  delete from public.invoice_lines where id=p_line;
end; $$;

create function public.finalize_invoice(p_invoice uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; customer public.customers%rowtype; settings public.business_settings%rowtype; total bigint; number bigint;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status='issued' then return inv.invoice_number; end if;
  if inv.status<>'draft' then raise exception 'Voided invoices cannot be finalized'; end if;
  if inv.issue_date>(now() at time zone 'America/Chicago')::date then raise exception 'Cannot issue a future-dated invoice'; end if;
  if not exists(select 1 from public.invoice_lines where invoice_id=p_invoice) then raise exception 'Add at least one line before finalizing'; end if;
  select sum(amount_cents) into total from public.invoice_lines where invoice_id=p_invoice;
  if total<0 or total>1000000000 then raise exception 'Invoice total must be between zero and $10,000,000'; end if;
  select * into customer from public.customers where id=inv.customer_id for share;
  select * into settings from public.business_settings where singleton for share;
  if not found then raise exception 'Business settings are missing'; end if;
  number:=nextval('public.invoice_number_seq');
  update public.invoices set status='issued',invoice_number=number,issued_total_cents=total,issued_at=now(),
    customer_snapshot=jsonb_build_object('name',customer.name,'email',customer.email,'phone',customer.phone),
    business_snapshot=jsonb_build_object('name','Squared Away Performance Horses','phone',settings.business_phone,'email',settings.business_email,'payment_instructions',settings.payment_instructions,'venmo_url',settings.venmo_url,'paypal_url',settings.paypal_url,'apple_cash_instructions',settings.apple_cash_instructions)
    where id=p_invoice;
  return number;
end; $$;

create function public.record_invoice_payment(p_request uuid,p_invoice uuid,p_amount integer,p_date date,p_method text,p_reference text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare balance bigint; existing public.invoice_payments%rowtype; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.invoices where id=p_invoice and status='issued' for update;
  if not found then raise exception 'Record payments only on finalized, non-voided invoices'; end if;
  select * into existing from public.invoice_payments where id=p_request;
  if found then
    if row(existing.invoice_id,existing.amount_cents,existing.paid_on,existing.method,existing.reference,existing.notes) is distinct from row(p_invoice,p_amount,p_date,p_method,p_reference,p_notes) then raise exception 'This payment form was already used. Reload for another payment.'; end if;
    return existing.id;
  end if;
  if p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Enter an actual payment date'; end if;
  select balance_cents into balance from public.invoice_totals where id=p_invoice;
  if p_amount is null or p_amount<=0 or p_amount>balance then raise exception 'Payment must be positive and cannot exceed the remaining balance'; end if;
  insert into public.invoice_payments(id,invoice_id,amount_cents,paid_on,method,reference,notes) values(p_request,p_invoice,p_amount,p_date,p_method,p_reference,p_notes);
  return p_request;
end; $$;

create function public.reverse_invoice_payment(p_payment uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare inv_id uuid; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a reversal reason'; end if;
  select invoice_id into inv_id from public.invoice_payments where id=p_payment;
  perform 1 from public.invoices where id=inv_id and status='issued' for update;
  if not found then raise exception 'Payment not found on an active invoice'; end if;
  update public.invoice_payments set reversed_at=now(),reversal_reason=p_reason where id=p_payment and reversed_at is null;
end; $$;

create function public.adjust_invoice(p_request uuid,p_invoice uuid,p_amount integer,p_date date,p_description text) returns uuid
language plpgsql security definer set search_path='' as $$ declare totals record; existing public.invoice_adjustments%rowtype; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.invoices where id=p_invoice and status='issued' for update;
  if not found then raise exception 'Adjustments require an active finalized invoice'; end if;
  select * into existing from public.invoice_adjustments where id=p_request;
  if found then
    if row(existing.invoice_id,existing.amount_cents,existing.adjustment_date,existing.description) is distinct from row(p_invoice,p_amount,p_date,p_description) then raise exception 'This adjustment form was already used. Reload for another adjustment.'; end if;
    return p_request;
  end if;
  if p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Enter an actual adjustment date'; end if;
  select * into totals from public.invoice_totals where id=p_invoice;
  if p_amount is null or p_amount=0 or totals.total_cents+p_amount<totals.paid_cents or totals.total_cents+p_amount>1000000000 then raise exception 'Adjustment cannot exceed the supported total or reduce the bill below payments already recorded'; end if;
  insert into public.invoice_adjustments(id,invoice_id,amount_cents,adjustment_date,description) values(p_request,p_invoice,p_amount,p_date,p_description);
  return p_request;
end; $$;

create function public.void_invoice(p_invoice uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$ begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.invoices where id=p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a void reason'; end if;
  if exists(select 1 from public.invoice_payments where invoice_id=p_invoice and reversed_at is null) then raise exception 'Reverse recorded payments before voiding an invoice; this action does not refund money'; end if;
  delete from public.invoice_expense_claims where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  delete from public.invoice_day_claims where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  update public.invoices set status='void',voided_at=coalesce(voided_at,now()),void_reason=coalesce(void_reason,p_reason) where id=p_invoice;
end; $$;

create function public.guard_claimed_expense() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if exists(select 1 from public.invoice_expense_claims where expense_id=old.id) and
    row(old.amount_cents,old.horse_id,old.expense_date,old.reimbursable,old.category_id,old.vendor,old.voided_at)
    is distinct from row(new.amount_cents,new.horse_id,new.expense_date,new.reimbursable,new.category_id,new.vendor,new.voided_at) then
    raise exception 'This expense is reserved on an invoice. Remove its draft line or void the unpaid invoice before changing its billed details.';
  end if;return new;
end; $$;
create trigger protect_billed_expense before update on public.expenses for each row execute function public.guard_claimed_expense();
create function public.guard_claimed_day() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if exists(select 1 from public.invoice_day_claims where stay_id=old.stay_id and day=old.day) then
    if tg_op='DELETE' then raise exception 'This day is reserved on an invoice. Remove the generated draft line or void the unpaid invoice first.'; end if;
    if new.status<>old.status then raise exception 'This day is reserved on an invoice. Remove the generated draft line or void the unpaid invoice first.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;return new;
end; $$;
create trigger protect_billed_day before update or delete on public.training_days for each row execute function public.guard_claimed_day();
revoke all on function public.guard_claimed_expense(),public.guard_claimed_day() from public;

revoke all on function public.create_invoice(uuid,uuid,uuid,date,date,date,date,text),public.update_invoice_header(uuid,date,date,text),public.add_invoice_line(uuid,uuid,text,integer),public.add_expense_chargeback(uuid,uuid,integer),public.add_calendar_training(uuid),public.remove_invoice_line(uuid),public.finalize_invoice(uuid),public.record_invoice_payment(uuid,uuid,integer,date,text,text,text),public.reverse_invoice_payment(uuid,text),public.adjust_invoice(uuid,uuid,integer,date,text),public.void_invoice(uuid,text) from public;
grant execute on function public.create_invoice(uuid,uuid,uuid,date,date,date,date,text),public.update_invoice_header(uuid,date,date,text),public.add_invoice_line(uuid,uuid,text,integer),public.add_expense_chargeback(uuid,uuid,integer),public.add_calendar_training(uuid),public.remove_invoice_line(uuid),public.finalize_invoice(uuid),public.record_invoice_payment(uuid,uuid,integer,date,text,text,text),public.reverse_invoice_payment(uuid,text),public.adjust_invoice(uuid,uuid,integer,date,text),public.void_invoice(uuid,text) to authenticated;

commit;
