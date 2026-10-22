alter table public.training_stays drop constraint training_stays_billing_day_check;
alter table public.training_stays add constraint training_stays_billing_day_check check(billing_day between 1 and 31);
alter table public.business_settings drop constraint business_settings_default_billing_day_check;
alter table public.business_settings add constraint business_settings_default_billing_day_check check(default_billing_day between 1 and 31);
alter table public.training_stays add column billing_schedule text not null default 'custom' check(billing_schedule in ('first_of_month','arrival_anniversary','custom')),
 add column recurring_enabled boolean not null default false,add column recurring_start_date date;
alter table public.training_stays add constraint recurring_start_valid check(
 (not recurring_enabled or recurring_start_date is not null) and
 (recurring_start_date is null or (recurring_start_date>=arrival_date and (departure_date is null or recurring_start_date<=departure_date))));
create table public.recurring_billing_cycles (
 id uuid primary key default gen_random_uuid(),stay_id uuid not null references public.training_stays(id),
 period_from date not null,period_to date not null check(period_to>=period_from),billing_date date not null,
 invoice_id uuid not null unique references public.invoices(id),schedule_snapshot jsonb not null,
 review_reason text,skipped_at timestamptz,skipped_by uuid references auth.users(id),skipped_reason text check(skipped_reason is null or length(trim(skipped_reason)) between 1 and 2000),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),last_attempt_at timestamptz not null default now(),
 unique(stay_id,period_from,period_to)
);
alter table public.recurring_billing_cycles enable row level security;
revoke all on public.recurring_billing_cycles from anon,authenticated;
grant select on public.recurring_billing_cycles to authenticated;
create policy admin_read on public.recurring_billing_cycles for select to authenticated using(public.is_admin());
create function public.billing_anchor_date(p_month date,p_day integer) returns date language plpgsql immutable set search_path='' as $$
begin
 if p_month is null or p_day is null or p_day not between 1 and 31 then raise exception 'Choose a billing day from 1 to 31'; end if;
 return date_trunc('month',p_month)::date+least(p_day,extract(day from date_trunc('month',p_month)+interval '1 month - 1 day')::integer)-1;
end; $$;
revoke all on function public.billing_anchor_date(date,integer) from public,anon;
grant execute on function public.billing_anchor_date(date,integer) to authenticated;

create function public.next_recurring_cycle(p_stay uuid,p_as_of date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.training_stays;c public.recurring_billing_cycles;i public.invoices;first_day date;last_day date;boundary date;bill_date date;anchor integer;as_of date:=coalesce(p_as_of,(now() at time zone 'America/Chicago')::date);
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into s from public.training_stays where id=p_stay;
 if not found then raise exception 'Training stay not found'; end if;
 if not s.recurring_enabled then return jsonb_build_object('state','disabled'); end if;
 select * into c from public.recurring_billing_cycles where stay_id=s.id order by period_to desc,created_at desc limit 1;
 if found then
  select * into i from public.invoices where id=c.invoice_id;
  if c.skipped_reason is null and i.status in ('draft','void') then
   return jsonb_build_object('state',case i.status when 'void' then 'voided' else 'review' end,'cycle_id',c.id,'invoice_id',i.id,'from',c.period_from,'to',c.period_to,'billing_date',c.billing_date,'reason',c.review_reason);
  end if;
  first_day:=c.period_to+1;
 else first_day:=s.recurring_start_date;
 end if;
 if s.departure_date is not null and first_day>s.departure_date then return jsonb_build_object('state','complete'); end if;
 anchor:=case s.billing_schedule when 'first_of_month' then 1 when 'arrival_anniversary' then extract(day from s.arrival_date)::integer else s.billing_day end;
 boundary:=public.billing_anchor_date(first_day,anchor);
 if boundary<=first_day then boundary:=public.billing_anchor_date((date_trunc('month',first_day)+interval '1 month')::date,anchor); end if;
 last_day:=least(boundary-1,coalesce(s.departure_date,boundary-1));bill_date:=last_day+1;
 return jsonb_build_object('state',case when bill_date<=as_of then 'due' else 'upcoming' end,'from',first_day,'to',last_day,'billing_date',bill_date,'anchor_day',anchor);
end; $$;
revoke all on function public.next_recurring_cycle(uuid,date) from public,anon;
grant execute on function public.next_recurring_cycle(uuid,date) to authenticated;

-- Private builder supports cycles spanning multiple calendar months. Round once per service.
create function public.build_recurring_charges(p_invoice uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;classified integer;eligible integer;billable integer;total numeric;segments jsonb;dates jsonb;line public.invoice_lines;line_id uuid;svc text;mode text;rate integer;b record;
begin
 select * into i from public.invoices where id=p_invoice and status='draft' for update;
 if not found then raise exception 'Choose a draft recurring invoice'; end if;
 select * into s from public.training_stays where id=i.stay_id for update;
 if s.billing_customer_id<>i.customer_id then raise exception 'Review the changed billing customer'; end if;
 if s.invoice_due_days is null then raise exception 'Record payment terms on the training agreement'; end if;
 if i.due_date<>i.issue_date+s.invoice_due_days then raise exception 'Payment terms changed. Review the draft due date before preparing again'; end if;
 if s.proration<>'calendar_days' then raise exception 'This agreement needs manual training-charge review and manual finalization'; end if;
 if i.period_from<s.arrival_date or (s.departure_date is not null and i.period_to>s.departure_date) then raise exception 'Stay dates changed. Review this cycle manually'; end if;
 eligible:=i.period_to-i.period_from+1;
 select count(*),count(*) filter(where status in ('worked','rest')),coalesce(jsonb_agg(day order by day) filter(where status in ('worked','rest')),'[]') into classified,billable,dates
  from public.training_days where stay_id=s.id and day between i.period_from and i.period_to;
 if classified<>eligible then raise exception 'Classify every training day in this cycle before automatic finalization'; end if;
 select coalesce(sum(x.billable_days*s.monthly_rate_cents::numeric/x.calendar_days),0),jsonb_agg(to_jsonb(x) order by x.month) into total,segments from (
  select date_trunc('month',d.day)::date as month,count(*) filter(where d.status in ('worked','rest')) as billable_days,
   extract(day from date_trunc('month',d.day)+interval '1 month - 1 day')::integer as calendar_days
  from public.training_days d where d.stay_id=s.id and d.day between i.period_from and i.period_to group by date_trunc('month',d.day)
 ) x;
 select * into line from public.invoice_lines where invoice_id=i.id and kind='training' limit 1;
 if found then
  if line.source_snapshot->'dates' is distinct from dates or (line.source_snapshot->>'monthly_rate_cents')::integer is distinct from s.monthly_rate_cents or line.amount_cents<>round(total)::integer then
   raise exception 'Training records or rate changed. Remove the generated training line and prepare again'; end if;
 else
  if exists(select 1 from public.invoice_day_claims where stay_id=s.id and day between i.period_from and i.period_to) then raise exception 'Some training dates are already reserved on another invoice'; end if;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values(i.id,'Training · '||billable||' worked/rest days',round(total)::integer,'training',jsonb_build_object('stay_id',s.id,'monthly_rate_cents',s.monthly_rate_cents,'billable_days',billable,'calendar_segments',segments,'dates',dates,'period_from',i.period_from,'period_to',i.period_to)) returning id into line_id;
  insert into public.invoice_day_claims(stay_id,day,line_id) select s.id,d.day,line_id from public.training_days d where d.stay_id=s.id and d.day between i.period_from and i.period_to and d.status in ('worked','rest');
 end if;
 foreach svc in array array['feed','boarding'] loop
  mode:=case svc when 'feed' then s.feed_billing else s.boarding_billing end;
  if mode='unrecorded' then raise exception 'Record the % agreement before automatic billing',svc; end if;
  if mode in ('included','not_provided') and exists(select 1 from public.invoice_lines where invoice_id=i.id and kind='service' and source_snapshot->>'service'=svc) then raise exception 'Remove the old % service charges after changing its agreement',svc; end if;
  if mode='at_cost' and exists(select 1 from public.invoice_lines where invoice_id=i.id and kind='service' and source_snapshot->>'service'=svc and source_snapshot->>'basis' is distinct from (case svc when 'feed' then 'consumption' else 'assigned_cost' end)) then raise exception 'Remove the old % rate charges before using actual-cost billing',svc; end if;

  if mode='separate_monthly' then
   rate:=case svc when 'feed' then s.feed_monthly_cents else s.boarding_monthly_cents end;
   if rate is null then raise exception 'Record the monthly % rate',svc; end if;
   select sum(x.boarding_days*rate::numeric/x.calendar_days),jsonb_agg(to_jsonb(x) order by x.month) into total,segments from (
    select date_trunc('month',d)::date as month,count(*) as boarding_days,extract(day from date_trunc('month',d)+interval '1 month - 1 day')::integer as calendar_days
    from generate_series(i.period_from,i.period_to,interval '1 day') d group by date_trunc('month',d)
   ) x;
   select * into line from public.invoice_lines where invoice_id=i.id and kind='service' and source_snapshot->>'service'=svc limit 1;
   if found then
    if line.source_snapshot->>'basis'<>'calendar_segments' or line.source_snapshot->'segments' is distinct from segments or (line.source_snapshot->>'monthly_rate_cents')::integer is distinct from rate or line.amount_cents<>round(total)::integer then raise exception '% rate or charges changed. Remove its generated line and prepare again',initcap(svc); end if;
   else
    if exists(select 1 from public.invoice_service_days where stay_id=s.id and service=svc and day between i.period_from and i.period_to) then raise exception '% dates are already reserved on an invoice',initcap(svc); end if;
    if svc='feed' and exists(select 1 from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id where c.stay_id=s.id and m.movement_date between i.period_from and i.period_to) then raise exception 'Feed dates were already billed at cost'; end if;
    if svc='boarding' and exists(select 1 from public.invoice_boarding_claims where stay_id=s.id and period_from<=i.period_to and period_to>=i.period_from) then raise exception 'Boarding dates were already billed at cost'; end if;
    insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values(i.id,initcap(svc)||' · '||eligible||' physical boarding days',round(total)::integer,'service',jsonb_build_object('service',svc,'basis','calendar_segments','stay_id',s.id,'monthly_rate_cents',rate,'segments',segments,'boarding_days',eligible,'period_from',i.period_from,'period_to',i.period_to)) returning id into line_id;
    insert into public.invoice_service_days(stay_id,service,day,line_id) select s.id,svc,d::date,line_id from generate_series(i.period_from,i.period_to,interval '1 day') d;
   end if;
  elsif mode='at_cost' and svc='feed' then
   if exists(select 1 from public.inventory_movements m where m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between i.period_from and i.period_to
     and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id) and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id)) then perform public.add_actual_feed(i.id); end if;
  elsif mode='at_cost' and svc='boarding' then
   for b in select v.split_id from public.boarding_invoice_sources v where v.stay_id=s.id and v.expense_date between i.period_from and i.period_to
     and not exists(select 1 from public.invoice_boarding_claims c where c.split_id=v.split_id and c.stay_id=v.stay_id)
     and not exists(select 1 from public.invoice_expense_claims c where c.expense_id=v.expense_id) order by v.expense_id,v.split_id loop
    perform public.add_actual_boarding(i.id,b.split_id);
   end loop;
  end if;
 end loop;
end; $$;
revoke all on function public.build_recurring_charges(uuid) from public,anon,authenticated;

create function public.prepare_recurring_invoice(p_stay uuid,p_expected_from date,p_expected_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.training_stays;cycle jsonb;c public.recurring_billing_cycles;invoice uuid;issue date;problem text;number bigint;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into s from public.training_stays where id=p_stay for update;
 if not found then raise exception 'Training stay not found'; end if;
 if p_expected_from is null or p_expected_to is null then raise exception 'Reload the billing preview before preparing'; end if;
 select * into c from public.recurring_billing_cycles where stay_id=s.id and period_from=p_expected_from and period_to=p_expected_to for update;
 if found and exists(select 1 from public.invoices where id=c.invoice_id and status='issued') then
  select invoice_number into number from public.invoices where id=c.invoice_id;
  return jsonb_build_object('cycle_id',c.id,'invoice_id',c.invoice_id,'state','issued','number',number);
 end if;
 cycle:=public.next_recurring_cycle(s.id);
 if (cycle->>'from')::date is distinct from p_expected_from or (cycle->>'to')::date is distinct from p_expected_to then raise exception 'The next cycle changed. Reload the preview before preparing'; end if;
 if cycle->>'state' not in ('due','review') then raise exception 'This stay has no due cycle available for preparation'; end if;
 if cycle->>'cycle_id' is not null then select * into c from public.recurring_billing_cycles where id=(cycle->>'cycle_id')::uuid for update;
 else
  invoice:=gen_random_uuid();issue:=(cycle->>'billing_date')::date;
  perform public.create_invoice(invoice,s.billing_customer_id,s.id,issue,issue+coalesce(s.invoice_due_days,0),(cycle->>'from')::date,(cycle->>'to')::date,'Recurring completed-cycle billing');
  insert into public.recurring_billing_cycles(stay_id,period_from,period_to,billing_date,invoice_id,schedule_snapshot,created_by)
  values(s.id,(cycle->>'from')::date,(cycle->>'to')::date,issue,invoice,jsonb_build_object('schedule',s.billing_schedule,'anchor',cycle->'anchor_day','first_period_start',s.recurring_start_date),auth.uid()) returning * into c;
 end if;
 begin perform public.build_recurring_charges(c.invoice_id);
 exception when others then get stacked diagnostics problem=message_text;end;
 if problem is null then
  begin number:=public.finalize_cost_reviewed_invoice(c.invoice_id);
  exception when others then get stacked diagnostics problem=message_text;end;
 end if;
 update public.recurring_billing_cycles set review_reason=problem,last_attempt_at=now() where id=c.id;
 return jsonb_build_object('cycle_id',c.id,'invoice_id',c.invoice_id,'state',case when number is null then 'review' else 'issued' end,'reason',problem,'number',number);
end; $$;
create function public.skip_voided_recurring_cycle(p_cycle uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter why this voided cycle should be skipped'; end if;
 perform 1 from public.recurring_billing_cycles c join public.invoices i on i.id=c.invoice_id where c.id=p_cycle and i.status='void' for update of c,i;
 if not found then raise exception 'Only a voided recurring invoice can be skipped'; end if;
 update public.recurring_billing_cycles set skipped_reason=coalesce(skipped_reason,trim(p_reason)),skipped_at=coalesce(skipped_at,now()),skipped_by=coalesce(skipped_by,auth.uid()) where id=p_cycle;
end; $$;
revoke all on function public.prepare_recurring_invoice(uuid,date,date),public.skip_voided_recurring_cycle(uuid,text) from public,anon;
grant execute on function public.prepare_recurring_invoice(uuid,date,date),public.skip_voided_recurring_cycle(uuid,text) to authenticated;

create function public.recurring_billing_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('stay_id',s.id,'horse_id',h.id,'horse_name',h.barn_name,'customer_name',c.name,
  'schedule',s.billing_schedule,'billing_day',s.billing_day,'next',public.next_recurring_cycle(s.id)) order by h.barn_name,s.arrival_date),'[]') into result
 from public.training_stays s join public.horses h on h.id=s.horse_id join public.customers c on c.id=s.billing_customer_id where s.recurring_enabled;
 return result;
end; $$;
revoke all on function public.recurring_billing_overview() from public,anon;
grant execute on function public.recurring_billing_overview() to authenticated;
