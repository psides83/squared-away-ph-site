-- Review is invoice-period specific. Manual finalization remains an explicit admin action.
create table public.invoice_cost_reviews (
 invoice_id uuid not null references public.invoices(id),service text not null check(service in ('feed','boarding')),
 snapshot jsonb not null,ready boolean not null,reviewed_at timestamptz not null default now(),reviewed_by uuid not null references auth.users(id),
 primary key(invoice_id,service)
);
create table public.invoice_cost_review_events (
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.invoices(id),service text not null,
 ready boolean not null,reason text not null check(length(trim(reason)) between 1 and 2000),snapshot jsonb not null,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id)
);
do $$ declare t text;begin foreach t in array array['invoice_cost_reviews','invoice_cost_review_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using(public.is_admin())',t);
end loop;end $$;

-- Private helper: include sources, claims and generated service lines in each review.
create function public.invoice_cost_review_snapshot(p_invoice uuid,p_service text) returns jsonb
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
   'from',i.period_from,'to',i.period_to,'service',p_service,'sources',sources,'lines',lines);
end; $$;
revoke all on function public.invoice_cost_review_snapshot(uuid,text) from public,anon,authenticated;

create function public.invoice_cost_readiness(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;service_key text;current_snapshot jsonb;r public.invoice_cost_reviews;rows jsonb:='[]';required boolean;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into i from public.invoices where id=p_invoice;
 if not found then raise exception 'Invoice not found'; end if;
 select * into s from public.training_stays where id=i.stay_id;
 foreach service_key in array array['feed','boarding'] loop
  required:=(case service_key when 'feed' then s.feed_billing else s.boarding_billing end)='at_cost';
  if coalesce(required,false) then
   select * into r from public.invoice_cost_reviews where invoice_id=i.id and invoice_cost_reviews.service=service_key;
   current_snapshot:=public.invoice_cost_review_snapshot(i.id,service_key);
   rows:=rows||jsonb_build_array(jsonb_build_object('service',service_key,'ready',coalesce(r.ready and r.snapshot=current_snapshot,false),
    'reviewed_at',r.reviewed_at,'changed',coalesce(r.ready and r.snapshot<>current_snapshot,false),
    'source_count',jsonb_array_length(current_snapshot->'sources'),'line_count',jsonb_array_length(current_snapshot->'lines')));
  end if;
 end loop;
 return rows;
end; $$;

create function public.set_invoice_cost_ready(p_invoice uuid,p_service text,p_ready boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare review_snapshot jsonb;i public.invoices;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_ready is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Confirm the review and enter a short reason'; end if;
 select * into i from public.invoices where id=p_invoice for update;
 if not found or i.status<>'draft' then raise exception 'Only a draft invoice can have its readiness changed'; end if;
 review_snapshot:=public.invoice_cost_review_snapshot(p_invoice,p_service);
 if exists(select 1 from public.invoice_cost_reviews r where r.invoice_id=p_invoice and r.service=p_service and r.ready=p_ready and r.snapshot=review_snapshot) then return; end if;
 insert into public.invoice_cost_reviews(invoice_id,service,snapshot,ready,reviewed_by)
 values(p_invoice,p_service,review_snapshot,p_ready,auth.uid()) on conflict(invoice_id,service)
 do update set snapshot=excluded.snapshot,ready=excluded.ready,reviewed_at=now(),reviewed_by=auth.uid();
 insert into public.invoice_cost_review_events(invoice_id,service,ready,reason,snapshot,created_by)
 values(p_invoice,p_service,p_ready,trim(p_reason),review_snapshot,auth.uid());
end; $$;

-- Only this guarded path is suitable for future automatic finalization.
-- Scheduling and completeness of other billing services remain separate work.
create function public.finalize_cost_reviewed_invoice(p_invoice uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare i public.invoices;s public.training_stays;readiness jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into i from public.invoices where id=p_invoice for update;
 if not found then raise exception 'Invoice not found'; end if;
 if i.status='issued' then return i.invoice_number; end if;
 select * into s from public.training_stays where id=i.stay_id for update;
 if s.id is not null then
  perform 1 from public.horses where id=s.horse_id for update;
  perform 1 from public.expenses e where exists(select 1 from public.boarding_invoice_sources b where b.expense_id=e.id and b.stay_id=s.id) order by e.id for update;
 end if;
 readiness:=public.invoice_cost_readiness(p_invoice);
 if exists(select 1 from jsonb_array_elements(readiness) r where not (r->>'ready')::boolean) then
  raise exception 'Mark every actual-cost period ready after reviewing its latest records and charges'; end if;

 if s.feed_billing='at_cost' and exists(
  select 1 from public.inventory_movements m where m.horse_id=s.horse_id and m.kind='feeding'
   and m.movement_date between greatest(i.period_from,s.arrival_date) and least(i.period_to,coalesce(s.departure_date,i.period_to))
   and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)
   and not exists(select 1 from public.invoice_feed_claims c where c.movement_id=m.id)
 ) then raise exception 'Generate all unbilled actual feed costs before automatic finalization'; end if;
 if s.boarding_billing='at_cost' and exists(
  select 1 from public.boarding_invoice_sources b where b.stay_id=s.id
   and b.expense_date between greatest(i.period_from,s.arrival_date) and least(i.period_to,coalesce(s.departure_date,i.period_to))
   and not exists(select 1 from public.invoice_boarding_claims c where c.split_id=b.split_id and c.stay_id=b.stay_id)
   and not exists(select 1 from public.invoice_expense_claims c where c.expense_id=b.expense_id)
 ) then raise exception 'Generate all unbilled actual boarding costs for this period before automatic finalization'; end if;
 return public.finalize_invoice(p_invoice);
end; $$;
revoke all on function public.invoice_cost_readiness(uuid),public.set_invoice_cost_ready(uuid,text,boolean,text),public.finalize_cost_reviewed_invoice(uuid) from public,anon;
grant execute on function public.invoice_cost_readiness(uuid),public.set_invoice_cost_ready(uuid,text,boolean,text),public.finalize_cost_reviewed_invoice(uuid) to authenticated;
