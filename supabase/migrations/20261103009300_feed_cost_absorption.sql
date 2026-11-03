begin;
create table public.feed_absorptions (
 id uuid primary key,movement_id uuid not null references public.inventory_movements(id),previous_id uuid references public.feed_absorptions(id),
 source_token text not null,captured_source jsonb not null,mode text not null check(mode in ('full','partial','review','clear')),
 requested_cents integer,amount_cents numeric(24,6) not null check(amount_cents>=0),reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index current_feed_absorption on public.feed_absorptions(movement_id) where retired_at is null;
alter table public.feed_absorptions enable row level security;
revoke all on public.feed_absorptions from public,anon,authenticated;
grant select on public.feed_absorptions to authenticated;
create policy admin_read on public.feed_absorptions for select to authenticated using((select public.is_admin()));
create view public.feed_absorption_sources with(security_invoker=true) as
select m.id as movement_id,m.product_id,m.horse_id,h.barn_name,p.name as product_name,m.movement_date,m.entered_quantity,m.unit_label,-m.value_delta_cents as cost_cents,
 md5(jsonb_build_array(m.id,m.product_id,m.horse_id,m.kind,m.movement_date,m.quantity_delta_oz,m.value_delta_cents)::text) as source_token,
 jsonb_build_object('movement_id',m.id,'product_id',m.product_id,'horse_id',m.horse_id,'horse',h.barn_name,'product',p.name,'date',m.movement_date,'quantity_oz',m.quantity_delta_oz,'cost_cents',-m.value_delta_cents) as captured_source
from public.inventory_movements m join public.horses h on h.id=m.horse_id join public.inventory_products p on p.id=m.product_id
where m.kind='feeding' and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id);
create view public.valid_feed_absorptions with(security_invoker=true) as
select a.* from public.feed_absorptions a join public.feed_absorption_sources s on s.movement_id=a.movement_id and s.source_token=a.source_token
where a.retired_at is null and a.mode<>'clear' and a.amount_cents<=s.cost_cents;
revoke all on public.feed_absorption_sources,public.valid_feed_absorptions from public,anon,authenticated;
create function public.feed_absorption_pending(p_movement uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.feed_absorptions a where a.movement_id=p_movement and a.retired_at is null and a.mode<>'clear' and not exists(select 1 from public.valid_feed_absorptions v where v.id=a.id))
$$;
create function public.feed_absorbed(p_movement uuid) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select amount_cents from public.valid_feed_absorptions where movement_id=p_movement),0)
$$;
revoke all on function public.feed_absorption_pending(uuid),public.feed_absorbed(uuid) from public,anon,authenticated;
create function public.set_feed_absorption(p_request uuid,p_movement uuid,p_current uuid,p_token text,p_mode text,p_cents integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.feed_absorptions;cur public.feed_absorptions;s public.feed_absorption_sources;product uuid;amount numeric;claimed boolean;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_movement is null or p_token is null or length(p_token)<>32 or p_mode is null or p_mode not in ('full','partial','review','clear') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or (p_mode='partial' and (p_cents is null or p_cents not between 1 and 100000000)) or (p_mode<>'partial' and p_cents is not null) then raise exception 'Choose a current feeding, fixed amount or full cost, and a private reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.feed_absorptions where id=p_request;
 if found then
  if row(old.movement_id,old.previous_id,old.source_token,old.mode,old.requested_cents,old.reason) is distinct from row(p_movement,p_current,p_token,p_mode,p_cents,trim(p_reason)) then raise exception 'This request was already used with different values';end if;return old.id;
 end if;
 select product_id into product from public.inventory_movements where id=p_movement;
 perform 1 from public.horses where id=(select horse_id from public.inventory_movements where id=p_movement) for update;
 perform 1 from public.inventory_products where id=product for update;
 select * into cur from public.feed_absorptions where movement_id=p_movement and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The absorbed amount changed. Close and reopen this editor';end if;
 select * into s from public.feed_absorption_sources where movement_id=p_movement;
 if not found then raise exception 'Choose an unreversed feeding assigned to a horse';end if;
 claimed:=exists(select 1 from public.invoice_feed_claims where movement_id=p_movement);
 if p_mode='clear' then
  if cur.id is null or cur.mode='clear' or p_token<>cur.source_token or claimed then raise exception 'Only an unbilled saved designation can be cleared';end if;amount:=0;
 else
  if s.source_token<>p_token then raise exception 'The recorded feeding cost changed. Close and reopen this editor';end if;
  if claimed and (p_mode<>'review' or cur.id is null or cur.mode='clear') then raise exception 'Already-billed feed uses its saved invoice decision. Only the same fixed absorbed amount can be reviewed';end if;
  if p_mode='review' then
   if cur.id is null or cur.mode='clear' then raise exception 'Choose an existing fixed absorbed amount to review';end if;amount:=cur.amount_cents;
  elsif p_mode='full' then amount:=s.cost_cents;
  else amount:=p_cents;end if;
  if amount>s.cost_cents then raise exception 'The absorbed amount exceeds the current recorded cost. Resolve the invoice if billed, or revise the unbilled designation';end if;
 end if;
 update public.feed_absorptions set retired_at=now() where id=cur.id;
 insert into public.feed_absorptions(id,movement_id,previous_id,source_token,captured_source,mode,requested_cents,amount_cents,reason,created_by)
 values(p_request,p_movement,p_current,case when p_mode='clear' then cur.source_token else p_token end,case when p_mode='clear' then cur.captured_source else s.captured_source end,p_mode,p_cents,amount,trim(p_reason),auth.uid());
 return p_request;
end;$$;
revoke all on function public.set_feed_absorption(uuid,uuid,uuid,text,text,integer,text) from public,anon;
grant execute on function public.set_feed_absorption(uuid,uuid,uuid,text,text,integer,text) to authenticated;
-- Prevent any billing/recovery path from bypassing the protected amount.
create function public.guard_absorbed_feed_claim() returns trigger language plpgsql security definer set search_path='' as $$
declare expected numeric;entry jsonb;snapshot jsonb;
begin
 if public.feed_absorption_pending(new.movement_id) then raise exception 'Review the changed absorbed feed cost before billing or restoring sources';end if;
 select source_snapshot into snapshot from public.invoice_lines where id=new.line_id;
 if jsonb_typeof(snapshot->'sources')='array' then select x into entry from jsonb_array_elements(snapshot->'sources') x where x->>'movement_id'=new.movement_id::text limit 1;end if;
 expected:=case when jsonb_typeof(entry->'absorbed_cost_cents')='number' then (entry->>'absorbed_cost_cents')::numeric else 0 end;
 if expected<>public.feed_absorbed(new.movement_id) then raise exception 'The invoice source does not match this feeding’s protected absorbed amount';end if;return new;
end;$$;
revoke all on function public.guard_absorbed_feed_claim() from public,anon,authenticated;
create trigger protect_absorbed_feed before insert on public.invoice_feed_claims for each row execute function public.guard_absorbed_feed_claim();
create function public.feed_absorption_report(p_from date,p_to date,p_horse uuid default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 or p_page is null or p_page not between 1 and 10000 then raise exception 'Choose valid dates and page';end if;
 with rows as (
 select s.*,exists(select 1 from public.invoice_feed_claims c where c.movement_id=s.movement_id) as claimed,(select l.invoice_id from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id where c.movement_id=s.movement_id limit 1) as claim_invoice_id,
 public.feed_absorption_pending(s.movement_id) as needs_review,public.feed_absorbed(s.movement_id) as absorbed_cents,
 case when a.id is null then null else to_jsonb(a)-'created_by' end as current,
 coalesce((select jsonb_agg(to_jsonb(x)-'created_by') from(select * from public.feed_absorptions where movement_id=s.movement_id order by created_at desc,id limit 10)x),'[]'::jsonb) as history
 from public.feed_absorption_sources s left join public.feed_absorptions a on a.movement_id=s.movement_id and a.retired_at is null
 where s.movement_date between p_from and p_to and (p_horse is null or s.horse_id=p_horse)
 ) select jsonb_build_object('count',(select count(*) from rows),'totals',(select jsonb_build_object('cost_cents',coalesce(round(sum(cost_cents)),0),'absorbed_cents',coalesce(round(sum(absorbed_cents)),0),'review_count',count(*) filter(where needs_review),'supported_unbilled_cents',coalesce(round(sum(cost_cents-absorbed_cents) filter(where not claimed and not needs_review and exists(select 1 from public.training_stays stay where stay.horse_id=r.horse_id and stay.feed_billing='at_cost' and r.movement_date>=stay.arrival_date and (stay.departure_date is null or r.movement_date<=stay.departure_date) and not exists(select 1 from public.invoice_service_days d where d.stay_id=stay.id and d.service='feed' and d.day=r.movement_date)))),0)) from rows r),
 'rows',coalesce((select jsonb_agg(to_jsonb(x) order by movement_date desc,movement_id) from(select * from rows order by movement_date desc,movement_id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)) into result;return result;
end;$$;
revoke all on function public.feed_absorption_report(date,date,uuid,integer) from public,anon;
grant execute on function public.feed_absorption_report(date,date,uuid,integer) to authenticated;

create or replace function public.add_actual_feed(p_invoice uuid) returns uuid language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from public.inventory_movements m where m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id) and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id) and public.feed_absorption_pending(m.id)) then raise exception 'Review changed absorbed feed costs before generating actual-cost charges';end if;
  select count(*),sum(-m.value_delta_cents-public.feed_absorbed(m.id)),jsonb_agg(jsonb_build_object('movement_id',m.id,'date',m.movement_date,'product',p.name,'quantity',m.entered_quantity,'unit',m.unit_label,'ounces_per_unit',m.ounces_per_unit,'gross_cost_cents',-m.value_delta_cents,'absorption_id',(select id from public.valid_feed_absorptions where movement_id=m.id),'absorbed_cost_cents',public.feed_absorbed(m.id),'cost_cents',-m.value_delta_cents-public.feed_absorbed(m.id)) order by m.movement_date,m.id)
    into source_count,total,source_rows from public.inventory_movements m join public.inventory_products p on p.id=m.product_id
    where m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day
    and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id) and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id);
  if source_count=0 then raise exception 'No unbilled, unreversed feeding records in this period'; end if;
  if total<0 or total>100000000 then raise exception 'Feed total is outside the supported invoice line range'; end if;
  insert into public.invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values(p_invoice,'Feed at actual consumption cost · '||source_count||' records',round(total)::integer,'service',jsonb_build_object('service','feed','basis','consumption','stay_id',s.id,'period_from',first_day,'period_to',last_day,'unrounded_cost_cents',total,'sources',source_rows)) returning id into line;
  insert into public.invoice_feed_claims(movement_id,stay_id,line_id) select (r->>'movement_id')::uuid,s.id,line from jsonb_array_elements(source_rows) r;
  return line;
end $$;
create or replace function public.invoice_service_options(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;first_day date;last_day date;feed jsonb;boarding jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into i from public.invoices where id=p_invoice;
  if not found then raise exception 'Invoice not found'; end if;
  select * into s from public.training_stays where id=i.stay_id;
  first_day:=greatest(i.period_from,s.arrival_date);last_day:=least(i.period_to,coalesce(s.departure_date,i.period_to));
  select jsonb_build_object('count',count(*),'amount_cents',coalesce(round(sum(-m.value_delta_cents-public.feed_absorbed(m.id)) filter(where not public.feed_absorption_pending(m.id))),0),'review_count',count(*) filter(where public.feed_absorption_pending(m.id))) into feed from public.inventory_movements m
    where i.period_from is not null and i.period_to is not null and m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day
    and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id) and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id);
  select coalesce(jsonb_agg(x order by expense_date,split_id),'[]') into boarding from (
    select b.* from public.boarding_invoice_sources b where b.stay_id=s.id
    and not exists(select 1 from public.invoice_boarding_claims c where c.split_id=b.split_id and c.stay_id=b.stay_id)
    and not exists(select 1 from public.invoice_expense_claims c where c.expense_id=b.expense_id)
  ) x;
  return jsonb_build_object('feed',feed,'boarding',boarding);
end $$;
create or replace function public.invoice_cost_review_snapshot(p_invoice uuid,p_service text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;first_day date;last_day date;sources jsonb;lines jsonb;
begin
 select * into i from public.invoices where id=p_invoice;
 select * into s from public.training_stays where id=i.stay_id;
 if i.id is null or s.id is null or i.period_from is null or i.period_to is null or i.period_to-i.period_from>365
  or i.period_to>(now() at time zone 'America/Chicago')::date then raise exception 'Choose an elapsed invoice period of at most 366 days linked to a training stay'; end if;
 if p_service is null or p_service not in ('feed','boarding') then raise exception 'Choose feed or boarding'; end if;
 if s.billing_customer_id<>i.customer_id or (case p_service when 'feed' then s.feed_billing else s.boarding_billing end)<>'at_cost' then raise exception 'Review the actual-cost agreement and billing customer first'; end if;
 first_day:=greatest(i.period_from,s.arrival_date);last_day:=least(i.period_to,coalesce(s.departure_date,i.period_to));
 if first_day>last_day then raise exception 'Invoice dates do not overlap this training stay'; end if;
 if p_service='feed' then
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'date',m.movement_date,'quantity',m.quantity_delta_oz,'cost',m.value_delta_cents,
    'reversed',exists(select 1 from public.inventory_movements r where r.reverses_id=m.id),'claim',c.line_id) order by m.id),'[]') into sources
  from public.inventory_movements m left join public.invoice_feed_claims c on c.movement_id=m.id
  where m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day;
 else
  select coalesce(jsonb_agg(jsonb_build_object('split',b.split_id,'expense',b.expense_id,'amount',b.amount_cents,'date',b.expense_date,
    'claim',c.line_id,'full_charge',e.line_id) order by b.split_id),'[]') into sources
  from public.boarding_invoice_sources b
  left join public.invoice_boarding_claims c on c.split_id=b.split_id and c.stay_id=b.stay_id
  left join public.invoice_expense_claims e on e.expense_id=b.expense_id where b.stay_id=s.id;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount_cents,'source',l.source_snapshot) order by l.id),'[]') into lines
 from public.invoice_lines l where l.invoice_id=i.id and l.kind='service' and l.source_snapshot->>'service'=p_service;
 return jsonb_build_object('stay',s.id,'horse',s.horse_id,'customer',s.billing_customer_id,'arrival',s.arrival_date,'departure',s.departure_date,
   'from',i.period_from,'to',i.period_to,'service',p_service,'sources',sources,'lines',lines,'feed_absorptions',case when p_service='feed' then (select jsonb_agg(jsonb_build_array(m.id,a.id,a.amount_cents,a.source_token,public.feed_absorption_pending(m.id)) order by m.id) from public.inventory_movements m left join public.feed_absorptions a on a.movement_id=m.id and a.retired_at is null where m.horse_id=s.horse_id and m.kind='feeding' and m.movement_date between first_day and last_day and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)) end);
end; $$;
create function public.feed_invoice_weight(p_line uuid,p_movement uuid,p_cost numeric) returns numeric language plpgsql stable security definer set search_path='' as $$
declare snap jsonb;x jsonb;absorbed numeric:=0;
begin select source_snapshot into snap from public.invoice_lines where id=p_line;
 if jsonb_typeof(snap->'sources')='array' then select v into x from jsonb_array_elements(snap->'sources') v where v->>'movement_id'=p_movement::text limit 1;end if;
 if jsonb_typeof(x->'absorbed_cost_cents')='number' then absorbed:=(x->>'absorbed_cost_cents')::numeric;end if;
 return greatest(p_cost-absorbed,0);end;$$;
revoke all on function public.feed_invoice_weight(uuid,uuid,numeric) from public,anon,authenticated;
create or replace view public.dated_feed_revenue with(security_invoker=true) as
with charge_sources as (
  select l.id as line_id,i.id as invoice_id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,
   i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,d.day as service_date,
   1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') as weight,
   d.day::text as tie_key,'monthly'::text as basis,s.id as stay_id
  from public.invoice_service_days d join public.invoice_lines l on l.id=d.line_id
  join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=d.stay_id
  where d.service='feed' and l.billing_category='feed' and i.status in ('draft','issued')

  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,l.amount_cents,s.horse_id,m.movement_date,
   public.feed_invoice_weight(l.id,m.id,-m.value_delta_cents),m.id::text,'actual_cost',s.id
  from public.invoice_feed_claims c join public.inventory_movements m on m.id=c.movement_id
  join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id
  join public.training_stays s on s.id=c.stay_id
  where l.billing_category='feed' and i.status in ('draft','issued') and not exists(select 1 from public.incomplete_actual_feed_sources x where x.line_id=l.id)

  union all
  select l.id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,p.feed_cents,s.horse_id,d.day,
   1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day'),d.day::text,'package',s.id
  from public.effective_package_reporting p join public.invoice_lines l on l.id=p.line_id
  join public.invoices i on i.id=l.invoice_id join public.training_stays s on s.id=i.stay_id
  join public.invoice_day_claims d on d.line_id=l.id
  where i.status in ('draft','issued') and (p.feed_cents>0 or p.feed_included is true)
  union all
  select m.line_id,m.invoice_id,m.status,m.invoice_number,m.customer_id,m.customer_snapshot,m.period_from,m.period_to,m.issue_date,m.amount_cents,m.horse_id,day::date,
   1::numeric,day::date::text,'manual_period',m.stay_id
  from public.valid_manual_feed_periods m cross join lateral generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day
 union all
 select m.line_id,m.invoice_id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,m.feed_cents,m.horse_id,d.day,
  case when m.source_kind='training' then 1::numeric/extract(day from date_trunc('month',d.day)+interval '1 month - 1 day') else 1::numeric end,d.day::text,'package',m.stay_id
 from public.valid_manual_service_periods m join public.invoices i on i.id=m.invoice_id
 cross join lateral (
  select day::date as day from generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day where m.source_kind='manual'
  union all select (x->>'day')::date from jsonb_array_elements(m.days) x where m.source_kind='training' and x->>'status' in ('worked','rest')
 ) d where m.package_reviewed
 union all
 select m.line_id,m.invoice_id,m.status,m.invoice_number,m.customer_id,m.customer_snapshot,m.period_from,m.period_to,m.issue_date,m.amount_cents,m.horse_id,day::date,
  1::numeric/extract(day from date_trunc('month',day)+interval '1 month - 1 day'),day::date::text,'monthly',m.stay_id
 from public.valid_monthly_service_periods m cross join lateral generate_series(m.covered_from::timestamp,m.covered_to::timestamp,interval '1 day') day where m.service='feed'
 ), weighted as (
  select *,case when sum(weight) over(partition by line_id)=0 then 1::numeric/count(*) over(partition by line_id)
   else weight/sum(weight) over(partition by line_id) end as fraction from charge_sources
 ), shares as (
  select *,floor(abs(amount_cents::numeric)*fraction) as whole,abs(amount_cents::numeric)*fraction-floor(abs(amount_cents::numeric)*fraction) as remainder from weighted
 ), allocated as (
  -- Largest remainder reconciles every saved line to exact cents, with stable ties.
  select *,sign(amount_cents::numeric)*(whole+case when row_number() over(partition by line_id order by remainder desc,service_date,tie_key)
    <=abs(amount_cents::numeric)-sum(whole) over(partition by line_id) then 1 else 0 end) as cents from shares
 ) select * from allocated;
revoke all on public.dated_feed_revenue from public,anon,authenticated;

create or replace function public.actual_cost_recovery_context(p_line uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.invoice_lines;i public.invoices;s public.training_stays;b public.boarding_invoice_sources;
 reason text;items jsonb;ids uuid[];source_count integer;linked_count integer:=0;missing_count integer:=0;claims jsonb;total numeric;first_day date;last_day date;split uuid;expense uuid;token text;
begin
 select * into l from public.invoice_lines where id=p_line;
 select * into i from public.invoices where id=l.invoice_id;
 select * into s from public.training_stays where id=i.stay_id;
 if l.id is null or i.status not in ('draft','issued') or l.kind<>'service' or l.amount_cents<0
  or not ((l.billing_category='feed' and l.source_snapshot->>'service'='feed' and l.source_snapshot->>'basis'='consumption')
   or (l.billing_category='boarding' and l.source_snapshot->>'service'='boarding' and l.source_snapshot->>'basis'='assigned_cost')) then
  return jsonb_build_object('id',l.id,'invoice_id',l.invoice_id,'description',l.description,'service',l.billing_category,'amount_cents',l.amount_cents,'source_cost_cents',null,'source_token',null,'sources','[]'::jsonb,'ready',false,'reason','Choose an active generated actual-cost feed or board charge');
 end if;
 if s.id is null or s.billing_customer_id<>i.customer_id or l.source_snapshot->>'stay_id' is distinct from s.id::text then reason:='The original invoice horse, stay or customer cannot be matched';end if;
 if coalesce(l.source_snapshot->>'period_from','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(l.source_snapshot->>'period_to','') !~ '^\d{4}-\d{2}-\d{2}$' then reason:=coalesce(reason,'The saved charge has no valid original covered dates');
 else
  begin first_day:=(l.source_snapshot->>'period_from')::date;last_day:=(l.source_snapshot->>'period_to')::date;
  exception when datetime_field_overflow or invalid_datetime_format then reason:=coalesce(reason,'The saved charge has invalid original covered dates');end;
 end if;
 if first_day is not null and (first_day>last_day or last_day-first_day>3660 or last_day>(now() at time zone 'America/Chicago')::date or first_day<s.arrival_date or last_day>s.departure_date) then reason:=coalesce(reason,'Original dates must be elapsed and fit the horse’s current stay');end if;
 if exists(select 1 from public.invoice_service_days where line_id=l.id) or exists(select 1 from public.invoice_feed_claims where line_id=l.id and l.billing_category<>'feed') or exists(select 1 from public.invoice_boarding_claims where line_id=l.id) then reason:=coalesce(reason,'This charge has incompatible or already complete source links');end if;
 if l.billing_category='feed' then
  if jsonb_typeof(l.source_snapshot->'sources') is distinct from 'array' then reason:=coalesce(reason,'The original feeding identifiers are missing');
  elsif jsonb_array_length(l.source_snapshot->'sources') not between 1 and 2000 then reason:=coalesce(reason,'Recover between one and 2,000 original feeding records at a time');
  elsif exists(select 1 from jsonb_array_elements(l.source_snapshot->'sources') x where coalesce(x->>'movement_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then reason:=coalesce(reason,'The original feeding identifiers are invalid');
  else
   select array_agg((x->>'movement_id')::uuid),count(distinct x->>'movement_id') into ids,source_count from jsonb_array_elements(l.source_snapshot->'sources') x;
   if source_count<>cardinality(ids) then reason:=coalesce(reason,'The saved feeding identifiers contain duplicates');end if;
   select sum(public.feed_invoice_weight(l.id,m.id,-m.value_delta_cents)),jsonb_agg(jsonb_build_object('movement_id',m.id,'product_id',m.product_id,'label',p.name,'date',m.movement_date,'horse_id',m.horse_id,'kind',m.kind,'quantity_oz',m.quantity_delta_oz,'gross_cost_cents',-m.value_delta_cents,'cost_cents',public.feed_invoice_weight(l.id,m.id,-m.value_delta_cents),'linked',exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id and c.line_id=l.id and c.stay_id=s.id)) order by m.movement_date,m.id) into total,items
   from public.inventory_movements m join public.inventory_products p on p.id=m.product_id where m.id=any(ids);
   if (select count(*) from public.inventory_movements where id=any(ids))<>cardinality(ids) then reason:=coalesce(reason,'Some original feeding records no longer exist');end if;
   if exists(select 1 from public.inventory_movements m where m.id=any(ids) and (m.kind<>'feeding' or m.horse_id is distinct from s.horse_id or m.movement_date<first_day or m.movement_date>last_day or exists(select 1 from public.inventory_movements r where r.reverses_id=m.id))) then reason:=coalesce(reason,'Original feedings must be unreversed and match this horse and saved period');end if;
   if exists(select 1 from public.invoice_feed_claims where movement_id=any(ids) and line_id<>l.id) then reason:=coalesce(reason,'An original feeding is already reserved on another charge');end if;
   select count(*),jsonb_agg(jsonb_build_array(movement_id,stay_id) order by movement_id) into linked_count,claims from public.invoice_feed_claims where line_id=l.id;
   missing_count:=cardinality(ids)-linked_count;
   if exists(select 1 from public.invoice_feed_claims c where c.line_id=l.id and (not(c.movement_id=any(ids)) or c.stay_id<>s.id)) then reason:=coalesce(reason,'Existing feeding links do not match the original source set and stay. Correct those links through the invoice workflow first');end if;
   if missing_count<=0 then reason:=coalesce(reason,'All original feeding links are already present');end if;
   if exists(select 1 from public.inventory_movements m where m.id=any(ids) and public.feed_absorption_pending(m.id)) then reason:=coalesce(reason,'Review the changed absorbed feed amounts before restoring sources');end if;
   if exists(select 1 from public.inventory_movements m where m.id=any(ids) and public.feed_absorbed(m.id)<>coalesce((select case when jsonb_typeof(x->'absorbed_cost_cents')='number' then (x->>'absorbed_cost_cents')::numeric else 0 end from jsonb_array_elements(l.source_snapshot->'sources') x where x->>'movement_id'=m.id::text limit 1),0)) then reason:=coalesce(reason,'The protected absorbed amount does not match the original invoice decision');end if;
   if exists(select 1 from public.invoice_service_days where stay_id=s.id and service='feed' and day between first_day and last_day) then reason:=coalesce(reason,'Feed dates are already reserved at a monthly rate');end if;
  end if;
 else
  if coalesce(l.source_snapshot->>'split_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(l.source_snapshot->>'expense_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then reason:=coalesce(reason,'The original boarding cost identifiers are missing or invalid');
  else
   split:=(l.source_snapshot->>'split_id')::uuid;expense:=(l.source_snapshot->>'expense_id')::uuid;
   select * into b from public.boarding_invoice_sources where split_id=split and stay_id=s.id;
   if b.split_id is null or b.expense_id<>expense or b.horse_id<>s.horse_id or coalesce(b.shared_allocation_id::text,'')<>coalesce(l.source_snapshot->>'shared_allocation_id','') then reason:=coalesce(reason,'The original reviewed expense/stay assignment is no longer current');end if;
   total:=b.amount_cents;missing_count:=1;
   items:=jsonb_build_array(jsonb_build_object('split_id',b.split_id,'expense_id',b.expense_id,'stay_id',b.stay_id,'horse_id',b.horse_id,'shared_allocation_id',b.shared_allocation_id,'label',b.vendor,'date',b.expense_date,'cost_cents',b.amount_cents));
   if exists(select 1 from public.invoice_boarding_claims where split_id=split and stay_id=s.id) or exists(select 1 from public.invoice_expense_claims where expense_id=expense) then reason:=coalesce(reason,'This original cost is already reserved on another invoice charge');end if;
   if exists(select 1 from public.invoice_service_days where stay_id=s.id and service='boarding' and day between first_day and last_day) then reason:=coalesce(reason,'Boarding dates are already reserved at a monthly rate');end if;
   if public.expense_absorbed(expense)>0 then reason:=coalesce(reason,'Review the expense’s absorbed amount before restoring boarding billing links');end if;
  end if;
 end if;
 if total is null or round(total)<>l.amount_cents then reason:=coalesce(reason,'Matched source costs do not equal the saved charge. Resolve the difference before recovery');end if;
 token:=md5(jsonb_build_array(l.id,l.invoice_id,l.created_at,l.kind,l.amount_cents,l.billing_category,l.source_snapshot,i.status,i.customer_id,s.id,s.horse_id,s.billing_customer_id,s.arrival_date,s.departure_date,items,claims)::text);
 return jsonb_build_object('id',l.id,'invoice_id',l.invoice_id,'description',l.description,'service',l.billing_category,'amount_cents',l.amount_cents,'source_cost_cents',round(total),'unrounded_source_cents',total,'source_token',token,'ready',reason is null,'reason',reason,'horse_id',s.horse_id,'stay_id',s.id,'from',first_day,'to',last_day,'linked_count',linked_count,'missing_count',greatest(missing_count,0),'sources',coalesce(items,'[]'::jsonb));
end;$$;

create or replace function public.feed_charge_comparison(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of at most ten years'; end if;
 with feeding as (
  -- Compare original service dates. A later reversal restates the original feeding.
  select m.*,-m.value_delta_cents as cost_cents from public.inventory_movements m
  where m.kind='feeding' and m.movement_date between p_from and p_to
  and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)
 ), allocated as (select line_id,invoice_id,status,invoice_number,customer_id,customer_snapshot,period_from,period_to,issue_date,amount_cents,horse_id,service_date,weight,tie_key,basis,fraction,whole,remainder,cents from public.dated_feed_revenue ), unsupported_invoices as (
  select distinct l.invoice_id from public.invoice_lines l
  where (l.billing_category='feed' and not exists(select 1 from allocated c where c.line_id=l.id)) or exists(select 1 from public.manual_package_review_queue q where q.line_id=l.id)
 ), adjustment_days as (
  select a.id as adjustment_id,c.invoice_id,c.horse_id,c.service_date,
   r.feed_cents::bigint as amount_cents,
   sign(a.amount_cents::numeric) as direction,sum(greatest(c.cents,0)) as weight
  from public.invoice_adjustments a join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
  join allocated c on c.invoice_id=a.invoice_id and c.status='issued'
  where r.feed_cents>0 and not exists(select 1 from unsupported_invoices u where u.invoice_id=a.invoice_id)
  group by a.id,c.invoice_id,c.horse_id,c.service_date,r.feed_cents
 ), adjustment_fractions as (
  select *,case when sum(weight) over(partition by adjustment_id)=0 then 1::numeric/count(*) over(partition by adjustment_id)
   else weight/sum(weight) over(partition by adjustment_id) end as fraction from adjustment_days
 ), adjustment_shares as (
  select *,floor(amount_cents*fraction) as whole,amount_cents*fraction-floor(amount_cents*fraction) as remainder from adjustment_fractions
 ), dated_adjustments as (
  select *,direction*(whole+case when row_number() over(partition by adjustment_id order by remainder desc,service_date,horse_id)
   <= amount_cents-sum(whole) over(partition by adjustment_id) then 1 else 0 end) as cents from adjustment_shares
 ), all_charges as (
  select * from allocated
  union all
  select da.adjustment_id,i.id,i.status,i.invoice_number,i.customer_id,i.customer_snapshot,i.period_from,i.period_to,i.issue_date,
   da.amount_cents,da.horse_id,da.service_date,da.weight,da.service_date::text,'adjustment',da.fraction,da.whole,da.remainder,da.cents
  from dated_adjustments da join public.invoices i on i.id=da.invoice_id
 ), period_charges as (select * from all_charges where service_date between p_from and p_to),
 horse_cost as (
  select horse_id,round(sum(cost_cents)) as cost_cents,count(*) as feeding_lines,count(distinct movement_date) as feeding_days,
   round(coalesce(sum(cost_cents-public.feed_absorbed(feeding.id)) filter(where not public.feed_absorption_pending(feeding.id) and exists(select 1 from public.training_stays s where s.horse_id=feeding.horse_id and s.feed_billing='at_cost' and feeding.movement_date>=s.arrival_date and (s.departure_date is null or feeding.movement_date<=s.departure_date))
    and not exists(select 1 from public.invoice_feed_claims c join public.invoice_lines l on l.id=c.line_id join public.invoices i on i.id=l.invoice_id where c.movement_id=feeding.id and i.status in ('draft','issued'))),0)) as unbilled_actual_cents
  ,round(sum(public.feed_absorbed(feeding.id))) as absorbed_cents,count(*) filter(where public.feed_absorption_pending(feeding.id)) as absorption_review_count
  from feeding group by horse_id
 ), horse_charges as (
  select horse_id,coalesce(sum(cents) filter(where status='issued'),0) as issued_cents,
   coalesce(sum(cents) filter(where status='draft'),0) as draft_cents,coalesce(sum(cents) filter(where status='issued' and basis='package'),0) as package_cents,coalesce(sum(cents) filter(where basis='adjustment'),0) as adjustment_cents from period_charges group by horse_id
 ), agreements as (
  select s.horse_id,jsonb_agg(jsonb_build_object('stay_id',s.id,'customer_id',s.billing_customer_id,'customer_name',c.name,'from',s.arrival_date,'to',s.departure_date,'mode',s.feed_billing,'monthly_cents',s.feed_monthly_cents) order by s.arrival_date,s.id) as entries,
   bool_or(s.feed_billing='included' and (
    not exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id join public.effective_package_reporting p on p.line_id=l.id and (p.feed_cents>0 or p.feed_included is not null)
     where i.stay_id=s.id and i.status in ('draft','issued') and i.period_from<=p_to and i.period_to>=p_from)
    and not exists(select 1 from public.valid_manual_service_periods mp where mp.stay_id=s.id and mp.package_reviewed and mp.covered_from<=p_to and mp.covered_to>=p_from)
    or exists(select 1 from public.invoices i join public.invoice_lines l on l.invoice_id=i.id
     where i.stay_id=s.id and i.status in ('draft','issued') and l.kind='training' and i.period_from<=p_to and i.period_to>=p_from
     and not exists(select 1 from public.effective_package_reporting p where p.line_id=l.id and (p.feed_cents>0 or p.feed_included is not null)))
   )) as included
  from public.training_stays s join public.customers c on c.id=s.billing_customer_id
  where s.arrival_date<=p_to and (s.departure_date is null or s.departure_date>=p_from) group by s.horse_id
 ), invoice_parts as (
  select horse_id,invoice_id,status,invoice_number,customer_id,coalesce(customer_snapshot->>'name',max(c.name)) as customer_name,
   period_from,period_to,issue_date,sum(cents) as cents,bool_or(basis='actual_cost') as actual_cost,bool_or(basis='manual_period' or basis='package' and exists(select 1 from public.valid_manual_service_periods mp where mp.line_id=pc.line_id and mp.package_reviewed)) as manual_period,
   exists(select 1 from public.invoice_adjustments a left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null
    where a.invoice_id=pc.invoice_id and (r.id is null or (r.feed_cents>0 and exists(select 1 from unsupported_invoices u where u.invoice_id=a.invoice_id)))) as has_adjustments,
   sum(cents) filter(where basis='package') as package_cents,coalesce(sum(cents) filter(where basis='adjustment'),0) as adjustment_cents
  from period_charges pc join public.customers c on c.id=pc.customer_id
  group by horse_id,invoice_id,status,invoice_number,customer_id,customer_snapshot,period_from,period_to,issue_date
 ), invoice_groups as (
  select horse_id,jsonb_agg(to_jsonb(ip)-'horse_id' order by issue_date,invoice_id) as entries,
   bool_or(has_adjustments and status='issued') as has_adjustments from invoice_parts ip group by horse_id
 ), unmatched as (
  select coalesce(st.horse_id,rl.horse_id) as horse_id,l.id as line_id,i.id as invoice_id,i.invoice_number,i.status,l.description,l.amount_cents,i.issue_date,
   case when l.kind='manual' then 'Review manual feed dates, amount and invoice horse assignment' else 'Feed line has no supported source allocation' end as reason
  from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
  left join public.training_stays st on st.id=i.stay_id
  left join public.invoice_reporting_links rl on rl.invoice_id=i.id and rl.retired_at is null and i.stay_id is null
  where l.billing_category='feed' and i.status in ('draft','issued')
   and ((coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from) or exists(select 1 from public.manual_feed_periods a where a.line_id=l.id and a.retired_at is null and a.covered_from<=p_to and a.covered_to>=p_from) or exists(select 1 from public.monthly_service_periods a where a.line_id=l.id and a.retired_at is null and not a.cleared and a.covered_from<=p_to and a.covered_to>=p_from))
   and not exists(select 1 from public.dated_feed_revenue d where d.line_id=l.id)
 union all
  select q.horse_id,q.line_id,q.invoice_id,q.invoice_number,q.status,q.description,q.feed_cents,q.issue_date,'Review manual package dates, classifications and split' from public.manual_package_review_queue q
  where q.covered_from<=p_to and q.covered_to>=p_from
 ), horse_ids as (
  select horse_id from horse_cost union select horse_id from horse_charges union select horse_id from agreements union select horse_id from unmatched
 ), rows as (
  select h.id as horse_id,h.barn_name as name,coalesce(c.cost_cents,0) as cost_cents,coalesce(c.feeding_lines,0) as feeding_lines,
   coalesce(c.feeding_days,0) as feeding_days,coalesce(c.unbilled_actual_cents,0) as unbilled_actual_cents,coalesce(c.absorbed_cents,0) as absorbed_cents,coalesce(c.absorption_review_count,0) as absorption_review_count,
   coalesce(ch.issued_cents,0) as issued_cents,coalesce(ch.draft_cents,0) as draft_cents,coalesce(ch.package_cents,0) as package_cents,coalesce(ch.adjustment_cents,0) as adjustment_cents,
   coalesce(ch.issued_cents,0)-coalesce(c.cost_cents,0) as difference_cents,
   case when coalesce(ch.issued_cents,0)>0 then round((ch.issued_cents-coalesce(c.cost_cents,0))*100/ch.issued_cents,2) end as margin_percent,
   coalesce(a.included,false) as included,(coalesce(ig.has_adjustments,false) or exists(
    select 1 from public.invoices i left join public.training_stays st on st.id=i.stay_id
    left join public.invoice_reporting_links rl on rl.invoice_id=i.id and rl.retired_at is null and i.stay_id is null
    join public.invoice_adjustments adj on adj.invoice_id=i.id
    left join public.adjustment_reporting_allocations ar on ar.adjustment_id=adj.id and ar.retired_at is null
    where i.status='issued' and coalesce(st.horse_id,rl.horse_id)=h.id
     and coalesce(i.period_from,i.issue_date)<=p_to and coalesce(i.period_to,i.issue_date)>=p_from
     and (ar.id is null or (ar.feed_cents>0 and not exists(select 1 from allocated ac where ac.invoice_id=i.id)))
   )) as has_adjustments,
   exists(select 1 from unmatched u where u.horse_id=h.id and u.status='issued') as has_unmatched,
   coalesce(a.entries,'[]'::jsonb) as agreements,coalesce(ig.entries,'[]'::jsonb) as invoices
  from horse_ids ids join public.horses h on h.id=ids.horse_id
  left join horse_cost c on c.horse_id=h.id left join horse_charges ch on ch.horse_id=h.id
  left join agreements a on a.horse_id=h.id left join invoice_groups ig on ig.horse_id=h.id
 ) select jsonb_build_object('horses',coalesce((select jsonb_agg(to_jsonb(r) order by name,horse_id) from rows r),'[]'::jsonb),
  'totals',(select jsonb_build_object('cost_cents',coalesce(sum(cost_cents),0),'issued_cents',coalesce(sum(issued_cents),0),'draft_cents',coalesce(sum(draft_cents),0),'package_cents',coalesce(sum(package_cents),0),'adjustment_cents',coalesce(sum(adjustment_cents),0),'unbilled_actual_cents',coalesce(sum(unbilled_actual_cents),0),'absorbed_cents',coalesce(sum(absorbed_cents),0),'absorption_review_count',coalesce(sum(absorption_review_count),0)) from rows),
  'unmatched_count',(select count(*) from unmatched),'unmatched_issued_cents',(select coalesce(sum(amount_cents) filter(where status='issued'),0) from unmatched),
  'unmatched',coalesce((select jsonb_agg(to_jsonb(u)) from (select * from unmatched order by issue_date,invoice_id,line_id limit 25) u),'[]'::jsonb),
  'unassigned_cost_cents',(select coalesce(round(sum(cost_cents)),0) from feeding where horse_id is null)) into result;
 return result;
end; $$;
revoke all on function public.feed_charge_comparison(date,date) from public,anon;
grant execute on function public.feed_charge_comparison(date,date) to authenticated;



commit;
