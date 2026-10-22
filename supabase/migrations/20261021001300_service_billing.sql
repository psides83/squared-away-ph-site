begin;
alter table public.invoice_lines drop constraint invoice_lines_kind_check;
alter table public.invoice_lines add constraint invoice_lines_kind_check check(kind in ('manual','training','expense','service'));
create table public.invoice_service_days (
  stay_id uuid not null references public.training_stays(id), service text not null check(service in ('feed','boarding')),
  day date not null, line_id uuid not null references public.invoice_lines(id) on delete cascade, primary key(stay_id,service,day)
);
create table public.invoice_feed_claims (
  movement_id uuid primary key references public.inventory_movements(id),stay_id uuid not null references public.training_stays(id),
  line_id uuid not null references public.invoice_lines(id) on delete cascade
);
create table public.invoice_boarding_claims (
  split_id uuid not null references public.cost_stay_splits(id),stay_id uuid not null references public.training_stays(id),
  expense_id uuid not null references public.expenses(id),period_from date not null,period_to date not null check(period_to>=period_from),
  line_id uuid not null references public.invoice_lines(id) on delete cascade,primary key(split_id,stay_id)
);
create index feed_claims_line on public.invoice_feed_claims(line_id);
create index service_days_line on public.invoice_service_days(line_id);
create index boarding_claims_line on public.invoice_boarding_claims(line_id);
create index boarding_claims_expense on public.invoice_boarding_claims(expense_id);
do $$ declare t text; begin
  foreach t in array array['invoice_service_days','invoice_feed_claims','invoice_boarding_claims'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy service_claims_admin on public.%I for select to authenticated using(public.is_admin())',t);
  end loop;
end $$;
create view public.boarding_invoice_sources with(security_invoker=true) as
select s.id as split_id,l.stay_id,c.expense_id,c.horse_id,c.shared_allocation_id,c.kind,c.expense_date,c.vendor,l.amount_cents
from public.reporting_cost_sources c join public.cost_stay_splits s on s.expense_id=c.expense_id and s.horse_id=c.horse_id and s.shared_allocation_id is not distinct from c.shared_allocation_id and s.retired_at is null
join public.cost_stay_split_lines l on l.split_id=s.id;
grant select on public.boarding_invoice_sources to authenticated;

create function public.add_monthly_service(p_invoice uuid,p_service text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.invoices; s public.training_stays; first_day date; last_day date; rate integer; mode text; days integer; divisor integer; line uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_service is null or p_service not in ('feed','boarding') then raise exception 'Choose feed or boarding'; end if;
  select * into i from public.invoices where id=p_invoice and status='draft' for update;
  if not found or i.stay_id is null then raise exception 'Choose a draft invoice linked to a training stay'; end if;
  select * into s from public.training_stays where id=i.stay_id for update;
  if s.billing_customer_id<>i.customer_id then raise exception 'Review the changed billing customer before generating charges'; end if;
  mode:=case p_service when 'feed' then s.feed_billing else s.boarding_billing end;
  rate:=case p_service when 'feed' then s.feed_monthly_cents else s.boarding_monthly_cents end;
  if mode<>'separate_monthly' or rate is null then raise exception 'This service needs a recorded separate monthly rate'; end if;
  if i.period_from is null or i.period_to is null or date_trunc('month',i.period_from)<>date_trunc('month',i.period_to) or i.period_to>(now() at time zone 'America/Chicago')::date then raise exception 'Choose an elapsed invoice period within one calendar month'; end if;
  first_day:=greatest(i.period_from,s.arrival_date);last_day:=least(i.period_to,coalesce(s.departure_date,i.period_to));
  if first_day>last_day then raise exception 'Invoice period does not overlap this stay'; end if;
  if exists(select 1 from public.invoice_service_days where stay_id=s.id and service=p_service and day between first_day and last_day) then raise exception 'Some service days are already reserved on an invoice'; end if;
  if p_service='feed' and exists(select 1 from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id where c.stay_id=s.id and m.movement_date between first_day and last_day) then raise exception 'Feed consumption for these dates is already billed at cost'; end if;
  if p_service='boarding' and exists(select 1 from public.invoice_boarding_claims where stay_id=s.id and period_from<=last_day and period_to>=first_day) then raise exception 'Boarding costs for this period are already billed at cost'; end if;
  days:=last_day-first_day+1;divisor:=extract(day from date_trunc('month',first_day)+interval '1 month - 1 day')::integer;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values(p_invoice,initcap(p_service)||' · '||days||' boarding days / '||divisor||' calendar days',round(rate::numeric*days/divisor)::integer,'service',jsonb_build_object('service',p_service,'basis','physical_days','stay_id',s.id,'monthly_rate_cents',rate,'boarding_days',days,'calendar_days',divisor,'period_from',first_day,'period_to',last_day)) returning id into line;
  insert into public.invoice_service_days(stay_id,service,day,line_id) select s.id,p_service,d::date,line from generate_series(first_day,last_day,interval '1 day') d;
  return line;
end $$;

create function public.add_actual_feed(p_invoice uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;first_day date;last_day date;line uuid;source_rows jsonb;total numeric;source_count integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into i from public.invoices where id=p_invoice and status='draft' for update;
  if not found or i.stay_id is null then raise exception 'Choose a draft invoice linked to a training stay'; end if;
  select * into s from public.training_stays where id=i.stay_id for update;
  if s.feed_billing<>'at_cost' or s.billing_customer_id<>i.customer_id then raise exception 'Review the stay customer and actual-cost feed agreement'; end if;
  if i.period_from is null or i.period_to is null or i.period_to-i.period_from>365 or i.period_to>(now() at time zone 'America/Chicago')::date then raise exception 'Choose an elapsed invoice period of at most 366 days'; end if;
  first_day:=greatest(i.period_from,s.arrival_date);last_day:=least(i.period_to,coalesce(s.departure_date,i.period_to));
  if first_day>last_day then raise exception 'Invoice period does not overlap this stay'; end if;
  -- Reversals and consumption both lock products. Keep the same lock order.
  perform 1 from public.inventory_products p where exists(select 1 from public.inventory_movements m where m.product_id=p.id and m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day) order by p.id for update;
  if exists(select 1 from public.invoice_service_days where stay_id=s.id and service='feed' and day between first_day and last_day) then raise exception 'Feed dates are already billed at a monthly rate'; end if;
  select count(*),sum(-m.value_delta_cents),jsonb_agg(jsonb_build_object('movement_id',m.id,'date',m.movement_date,'product',p.name,'quantity',m.entered_quantity,'unit',m.unit_label,'ounces_per_unit',m.ounces_per_unit,'cost_cents',-m.value_delta_cents) order by m.movement_date,m.id)
    into source_count,total,source_rows from public.inventory_movements m join public.inventory_products p on p.id=m.product_id
    where m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day
    and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id) and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id);
  if source_count=0 then raise exception 'No unbilled, unreversed feeding records in this period'; end if;
  if total<0 or total>100000000 then raise exception 'Feed total is outside the supported invoice line range'; end if;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values(p_invoice,'Feed at actual consumption cost · '||source_count||' records',round(total)::integer,'service',jsonb_build_object('service','feed','basis','consumption','stay_id',s.id,'period_from',first_day,'period_to',last_day,'unrounded_cost_cents',total,'sources',source_rows)) returning id into line;
  insert into public.invoice_feed_claims(movement_id,stay_id,line_id) select (r->>'movement_id')::uuid,s.id,line from jsonb_array_elements(source_rows) r;
  return line;
end $$;
create function public.add_actual_boarding(p_invoice uuid,p_split uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;source public.boarding_invoice_sources;expense uuid;first_day date;last_day date;line uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into i from public.invoices where id=p_invoice and status='draft' for update;
  if not found or i.stay_id is null then raise exception 'Choose a draft invoice linked to a training stay'; end if;
  select * into s from public.training_stays where id=i.stay_id for update;
  if s.boarding_billing<>'at_cost' or s.billing_customer_id<>i.customer_id then raise exception 'Review the stay customer and actual-cost boarding agreement'; end if;
  if i.period_from is null or i.period_to is null or i.period_to-i.period_from>365 or i.period_to>(now() at time zone 'America/Chicago')::date then raise exception 'Choose an elapsed invoice period of at most 366 days'; end if;
  first_day:=greatest(i.period_from,s.arrival_date);last_day:=least(i.period_to,coalesce(s.departure_date,i.period_to));
  if first_day>last_day then raise exception 'Invoice period does not overlap this stay'; end if;
  select expense_id into expense from public.cost_stay_splits where id=p_split;
  perform 1 from public.expenses where id=expense for update;
  select * into source from public.boarding_invoice_sources where split_id=p_split and stay_id=s.id;
  if not found then raise exception 'Select a current reviewed cost assigned to this stay'; end if;
  if exists(select 1 from public.invoice_expense_claims where expense_id=source.expense_id) then raise exception 'This expense is already reserved as a full charge-back'; end if;
  if exists(select 1 from public.invoice_boarding_claims where split_id=p_split and stay_id=s.id) then raise exception 'This stay cost is already reserved on an invoice'; end if;
  if exists(select 1 from public.invoice_service_days where stay_id=s.id and service='boarding' and day between first_day and last_day) then raise exception 'Boarding dates are already billed at a monthly rate'; end if;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values(p_invoice,'Boarding at actual cost · '||coalesce(source.vendor,'recorded expense'),source.amount_cents,'service',jsonb_build_object('service','boarding','basis','assigned_cost','stay_id',s.id,'split_id',source.split_id,'expense_id',source.expense_id,'shared_allocation_id',source.shared_allocation_id,'expense_date',source.expense_date,'original_cost_cents',source.amount_cents,'period_from',first_day,'period_to',last_day)) returning id into line;
  insert into public.invoice_boarding_claims(split_id,stay_id,expense_id,period_from,period_to,line_id) values(p_split,s.id,source.expense_id,first_day,last_day,line);
  return line;
end $$;

create function public.guard_service_billing_sources() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='inventory_movements' then
    if new.reverses_id is not null and exists(select 1 from public.invoice_feed_claims where movement_id=new.reverses_id) then raise exception 'This feeding is reserved on an invoice. Remove its draft line or void the unpaid invoice before correcting it'; end if;
  elsif tg_table_name='invoice_expense_claims' then
    if exists(select 1 from public.invoice_boarding_claims where expense_id=new.expense_id) then raise exception 'Some of this expense is already billed as boarding. Do not bill the full expense again'; end if;
  elsif tg_table_name='cost_stay_splits' then
    if new.retired_at is distinct from old.retired_at and exists(select 1 from public.invoice_boarding_claims where split_id=old.id) then raise exception 'This stay cost is reserved on an invoice. Remove its draft line or void the unpaid invoice before revising it'; end if;
  elsif tg_table_name='expense_allocations' then
    if new.retired_at is distinct from old.retired_at and exists(select 1 from public.invoice_boarding_claims b join public.cost_stay_splits s on s.id=b.split_id where s.shared_allocation_id=old.id) then raise exception 'This shared cost is reserved as boarding on an invoice. Remove its draft line or void the unpaid invoice before revising it'; end if;
  elsif tg_table_name='training_stays' then
    if row(new.arrival_date,new.departure_date) is distinct from row(old.arrival_date,old.departure_date) and (
      exists(select 1 from public.invoice_service_days where stay_id=old.id and (day<new.arrival_date or day>new.departure_date))
      or exists(select 1 from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id where c.stay_id=old.id and (m.movement_date<new.arrival_date or m.movement_date>new.departure_date))
      or exists(select 1 from public.invoice_boarding_claims where stay_id=old.id and (period_from<new.arrival_date or period_to>new.departure_date))) then raise exception 'Stay dates cannot exclude service days or costs reserved on an invoice'; end if;
  end if;
  return new;
end $$;
create trigger protect_billed_feed_reversal before insert on public.inventory_movements for each row execute function public.guard_service_billing_sources();
create trigger protect_billed_board_expense before insert on public.invoice_expense_claims for each row execute function public.guard_service_billing_sources();
create trigger protect_billed_stay_split before update on public.cost_stay_splits for each row execute function public.guard_service_billing_sources();
create trigger protect_billed_board_allocation before update on public.expense_allocations for each row execute function public.guard_service_billing_sources();
create trigger protect_billed_service_dates before update on public.training_stays for each row execute function public.guard_service_billing_sources();

create or replace function public.void_invoice(p_invoice uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$ begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.invoices where id=p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a void reason'; end if;
  if exists(select 1 from public.invoice_payments where invoice_id=p_invoice and reversed_at is null) then raise exception 'Reverse recorded payments before voiding an invoice; this action does not refund money'; end if;
  delete from public.invoice_expense_claims where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  delete from public.invoice_day_claims where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  delete from public.invoice_service_days where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  delete from public.invoice_feed_claims where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  delete from public.invoice_boarding_claims where line_id in(select id from public.invoice_lines where invoice_id=p_invoice);
  update public.invoices set status='void',voided_at=coalesce(voided_at,now()),void_reason=coalesce(void_reason,p_reason) where id=p_invoice;
end; $$;


create function public.invoice_service_options(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;first_day date;last_day date;feed jsonb;boarding jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into i from public.invoices where id=p_invoice;
  if not found then raise exception 'Invoice not found'; end if;
  select * into s from public.training_stays where id=i.stay_id;
  first_day:=greatest(i.period_from,s.arrival_date);last_day:=least(i.period_to,coalesce(s.departure_date,i.period_to));
  select jsonb_build_object('count',count(*),'amount_cents',coalesce(round(sum(-m.value_delta_cents)),0)) into feed from public.inventory_movements m
    where i.period_from is not null and i.period_to is not null and m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day
    and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id) and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id);
  select coalesce(jsonb_agg(x order by expense_date,split_id),'[]') into boarding from (
    select b.* from public.boarding_invoice_sources b where b.stay_id=s.id
    and not exists(select 1 from public.invoice_boarding_claims c where c.split_id=b.split_id and c.stay_id=b.stay_id)
    and not exists(select 1 from public.invoice_expense_claims c where c.expense_id=b.expense_id)
  ) x;
  return jsonb_build_object('feed',feed,'boarding',boarding);
end $$;
revoke all on function public.add_monthly_service(uuid,text),public.add_actual_feed(uuid),public.add_actual_boarding(uuid,uuid),public.invoice_service_options(uuid),public.guard_service_billing_sources() from public;
grant execute on function public.add_monthly_service(uuid,text),public.add_actual_feed(uuid),public.add_actual_boarding(uuid,uuid),public.invoice_service_options(uuid) to authenticated;
commit;
