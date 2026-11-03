begin;
create table public.actual_cost_source_recoveries (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),line_id uuid not null,
 source_token text not null,captured_source jsonb not null,
 reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table public.actual_cost_source_recoveries enable row level security;
revoke all on public.actual_cost_source_recoveries from public,anon,authenticated;
grant select on public.actual_cost_source_recoveries to authenticated;
create policy admin_read on public.actual_cost_source_recoveries for select to authenticated using((select public.is_admin()));
-- Private preflight: only retained original identifiers are used. No date-only fallback.
create function public.actual_cost_recovery_context(p_line uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.invoice_lines;i public.invoices;s public.training_stays;b public.boarding_invoice_sources;
 reason text;items jsonb;ids uuid[];source_count integer;total numeric;first_day date;last_day date;split uuid;expense uuid;token text;
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
 if exists(select 1 from public.invoice_service_days where line_id=l.id) or exists(select 1 from public.invoice_feed_claims where line_id=l.id) or exists(select 1 from public.invoice_boarding_claims where line_id=l.id) then reason:=coalesce(reason,'This charge already has source links; partial repairs need separate review');end if;
 if l.billing_category='feed' then
  if jsonb_typeof(l.source_snapshot->'sources') is distinct from 'array' then reason:=coalesce(reason,'The original feeding identifiers are missing');
  elsif jsonb_array_length(l.source_snapshot->'sources') not between 1 and 2000 then reason:=coalesce(reason,'Recover between one and 2,000 original feeding records at a time');
  elsif exists(select 1 from jsonb_array_elements(l.source_snapshot->'sources') x where coalesce(x->>'movement_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then reason:=coalesce(reason,'The original feeding identifiers are invalid');
  else
   select array_agg((x->>'movement_id')::uuid),count(distinct x->>'movement_id') into ids,source_count from jsonb_array_elements(l.source_snapshot->'sources') x;
   if source_count<>cardinality(ids) then reason:=coalesce(reason,'The saved feeding identifiers contain duplicates');end if;
   select sum(-m.value_delta_cents),jsonb_agg(jsonb_build_object('movement_id',m.id,'product_id',m.product_id,'label',p.name,'date',m.movement_date,'horse_id',m.horse_id,'kind',m.kind,'quantity_oz',m.quantity_delta_oz,'cost_cents',-m.value_delta_cents) order by m.movement_date,m.id) into total,items
   from public.inventory_movements m join public.inventory_products p on p.id=m.product_id where m.id=any(ids);
   if (select count(*) from public.inventory_movements where id=any(ids))<>cardinality(ids) then reason:=coalesce(reason,'Some original feeding records no longer exist');end if;
   if exists(select 1 from public.inventory_movements m where m.id=any(ids) and (m.kind<>'feeding' or m.horse_id is distinct from s.horse_id or m.movement_date<first_day or m.movement_date>last_day or exists(select 1 from public.inventory_movements r where r.reverses_id=m.id))) then reason:=coalesce(reason,'Original feedings must be unreversed and match this horse and saved period');end if;
   if exists(select 1 from public.invoice_feed_claims where movement_id=any(ids)) then reason:=coalesce(reason,'An original feeding is already reserved on another charge');end if;
   if exists(select 1 from public.invoice_service_days where stay_id=s.id and service='feed' and day between first_day and last_day) then reason:=coalesce(reason,'Feed dates are already reserved at a monthly rate');end if;
  end if;
 else
  if coalesce(l.source_snapshot->>'split_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(l.source_snapshot->>'expense_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then reason:=coalesce(reason,'The original boarding cost identifiers are missing or invalid');
  else
   split:=(l.source_snapshot->>'split_id')::uuid;expense:=(l.source_snapshot->>'expense_id')::uuid;
   select * into b from public.boarding_invoice_sources where split_id=split and stay_id=s.id;
   if b.split_id is null or b.expense_id<>expense or b.horse_id<>s.horse_id or coalesce(b.shared_allocation_id::text,'')<>coalesce(l.source_snapshot->>'shared_allocation_id','') then reason:=coalesce(reason,'The original reviewed expense/stay assignment is no longer current');end if;
   total:=b.amount_cents;
   items:=jsonb_build_array(jsonb_build_object('split_id',b.split_id,'expense_id',b.expense_id,'stay_id',b.stay_id,'horse_id',b.horse_id,'shared_allocation_id',b.shared_allocation_id,'label',b.vendor,'date',b.expense_date,'cost_cents',b.amount_cents));
   if exists(select 1 from public.invoice_boarding_claims where split_id=split and stay_id=s.id) or exists(select 1 from public.invoice_expense_claims where expense_id=expense) then reason:=coalesce(reason,'This original cost is already reserved on another invoice charge');end if;
   if exists(select 1 from public.invoice_service_days where stay_id=s.id and service='boarding' and day between first_day and last_day) then reason:=coalesce(reason,'Boarding dates are already reserved at a monthly rate');end if;
   if public.expense_absorbed(expense)>0 then reason:=coalesce(reason,'Review the expense’s absorbed amount before restoring boarding billing links');end if;
  end if;
 end if;
 if total is null or round(total)<>l.amount_cents then reason:=coalesce(reason,'Matched source costs do not equal the saved charge. Resolve the difference before recovery');end if;
 token:=md5(jsonb_build_array(l.id,l.invoice_id,l.created_at,l.kind,l.amount_cents,l.billing_category,l.source_snapshot,i.status,i.customer_id,s.id,s.horse_id,s.billing_customer_id,s.arrival_date,s.departure_date,items)::text);
 return jsonb_build_object('id',l.id,'invoice_id',l.invoice_id,'description',l.description,'service',l.billing_category,'amount_cents',l.amount_cents,'source_cost_cents',round(total),'unrounded_source_cents',total,'source_token',token,'ready',reason is null,'reason',reason,'horse_id',s.horse_id,'stay_id',s.id,'from',first_day,'to',last_day,'sources',coalesce(items,'[]'::jsonb));
end;$$;
revoke all on function public.actual_cost_recovery_context(uuid) from public,anon,authenticated;
create function public.actual_cost_recovery_options(p_invoice uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with rows as (
 select l.id from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
 where i.id=p_invoice and i.status in ('draft','issued') and l.kind='service'
 and ((l.billing_category='feed' and l.source_snapshot->>'basis'='consumption') or (l.billing_category='boarding' and l.source_snapshot->>'basis'='assigned_cost'))
 and not exists(select 1 from public.invoice_service_days d where d.line_id=l.id) and not exists(select 1 from public.invoice_feed_claims c where c.line_id=l.id) and not exists(select 1 from public.invoice_boarding_claims c where c.line_id=l.id)
 ) select jsonb_build_object('count',(select count(*) from rows),'lines',coalesce((select jsonb_agg(public.actual_cost_recovery_context(x.id) order by x.id) from(select * from rows order by id limit 25 offset (p_page-1)*25)x),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(x)-'created_by' order by created_at desc,id) from(select * from public.actual_cost_source_recoveries where invoice_id=p_invoice order by created_at desc,id limit 10)x),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function public.actual_cost_recovery_options(uuid,integer) from public,anon;
grant execute on function public.actual_cost_recovery_options(uuid,integer) to authenticated;
create function public.recover_actual_cost_sources(p_request uuid,p_line uuid,p_token text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.actual_cost_source_recoveries;invoice uuid;stay uuid;ctx jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_line is null or p_token is null or length(p_token)<>32 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Choose a current source review and enter a private reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.actual_cost_source_recoveries where id=p_request;
 if found then
  if row(prior.line_id,prior.source_token,prior.reason) is distinct from row(p_line,p_token,trim(p_reason)) then raise exception 'This request was already used with different values';end if;return prior.id;
 end if;
 select invoice_id into invoice from public.invoice_lines where id=p_line;
 perform 1 from public.invoices where id=invoice for update;
 if not found then raise exception 'Invoice line not found';end if;
 select stay_id into stay from public.invoices where id=invoice;
 perform 1 from public.training_stays where id=stay for update;
 -- The invoice/stay locks serialize competing billing; product/expense locks serialize source corrections.
 perform 1 from public.inventory_products p where exists(select 1 from public.inventory_movements m where m.product_id=p.id and m.horse_id=(select horse_id from public.training_stays where id=stay)) order by p.id for update;
 perform 1 from public.expenses e where exists(select 1 from public.boarding_invoice_sources b where b.expense_id=e.id and b.stay_id=stay) order by e.id for update;
 ctx:=public.actual_cost_recovery_context(p_line);
 if not coalesce((ctx->>'ready')::boolean,false) then raise exception '%',coalesce(ctx->>'reason','Original source records cannot be matched');end if;
 if ctx->>'source_token'<>p_token then raise exception 'The invoice or original source records changed. Close and reopen this review';end if;
 if ctx->>'service'='feed' then
  insert into public.invoice_feed_claims(movement_id,stay_id,line_id) select (x->>'movement_id')::uuid,stay,p_line from jsonb_array_elements(ctx->'sources') x;
 else
  insert into public.invoice_boarding_claims(split_id,stay_id,expense_id,period_from,period_to,line_id)
  select (x->>'split_id')::uuid,stay,(x->>'expense_id')::uuid,(ctx->>'from')::date,(ctx->>'to')::date,p_line from jsonb_array_elements(ctx->'sources') x;
 end if;
 insert into public.actual_cost_source_recoveries(id,invoice_id,line_id,source_token,captured_source,reason,created_by) values(p_request,invoice,p_line,p_token,ctx,trim(p_reason),auth.uid());
 return p_request;
end;$$;
revoke all on function public.recover_actual_cost_sources(uuid,uuid,text,text) from public,anon;
grant execute on function public.recover_actual_cost_sources(uuid,uuid,text,text) to authenticated;
commit;
