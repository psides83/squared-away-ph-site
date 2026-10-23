begin;
create function public.revalue_inventory_cost(p_request uuid,p_movement uuid,p_expected integer,p_cost integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.inventory_movements;r public.inventory_movements;prior public.inventory_cost_corrections;
 q numeric:=0;v numeric:=0;cost numeric;reversed_cost numeric;balance public.inventory_balances;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_movement is null or p_expected is null or p_cost is null or p_cost not between 0 and 100000000 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter the corrected cost and a reason';end if;
 select * into m from public.inventory_movements where id=p_movement;
 if not found or m.kind not in ('purchase','opening','adjustment_in') then raise exception 'Choose a purchase, opening stock or stock addition';end if;
 perform 1 from public.inventory_products where id=m.product_id for update;
 select * into prior from public.inventory_cost_corrections where id=p_request;
 if found then
  if row(prior.movement_id,prior.old_cost_cents,prior.new_cost_cents,prior.reason) is distinct from row(p_movement,p_expected,p_cost,trim(p_reason)) then raise exception 'This correction form was already used. Reload';end if;
  return prior.id;
 end if;
 select * into m from public.inventory_movements where id=p_movement;
 if m.value_delta_cents<>p_expected then raise exception 'This stock cost changed. Reload before correcting it';end if;
 if p_cost=p_expected then raise exception 'Enter a different cost';end if;
 if exists(select 1 from public.inventory_movements where reverses_id=m.id) then raise exception 'This stock entry was reversed; correct its replacement instead';end if;
 if (select count(*) from public.inventory_movements where product_id=m.product_id)>2000 then raise exception 'This product has more than 2,000 movements and needs a larger-history correction workflow';end if;
 -- Historical equal timestamps have no reliable recording order. Never guess.
 if exists(select 1 from public.inventory_movements where product_id=m.product_id group by created_at having count(*)>1 and bool_or(legacy_order)) then raise exception 'This product has stock entries with the same recording time. Their order needs review before recalculation';end if;
 select * into balance from public.inventory_balances where product_id=m.product_id;
 if row(balance.quantity_oz,balance.value_cents) is distinct from (
  select row(sum(quantity_delta_oz),sum(value_delta_cents)) from public.inventory_movements where product_id=m.product_id
 ) then raise exception 'Stock history does not reconcile with its balance. Review it before recalculating';end if;
 -- Only purchases affect cash expenses; opening/inbound valuations never do.
 if m.kind='purchase' then
  perform 1 from public.expenses where id=m.expense_id and voided_at is null and amount_cents=m.value_delta_cents for update;
  if not found then raise exception 'The purchase expense is missing, voided or does not match its stock cost';end if;
  update public.expenses set amount_cents=p_cost where id=m.expense_id;
 elsif m.expense_id is not null then raise exception 'This stock addition has an unexpected expense link. Review it first';
 end if;
 insert into public.inventory_cost_corrections(id,movement_id,old_cost_cents,new_cost_cents,reason,created_by)
 values(p_request,m.id,p_expected,p_cost,trim(p_reason),auth.uid());
 for r in select * from public.inventory_movements where product_id=m.product_id order by recording_order loop
  cost:=r.value_delta_cents;
  if r.id=m.id then cost:=p_cost;
  elsif r.kind in ('feeding','waste','adjustment_out') then
   if q<=0 or -r.quantity_delta_oz>q then raise exception 'Stock history has an invalid consumption balance';end if;
   cost:=case when -r.quantity_delta_oz=q then -v else -round(v*(-r.quantity_delta_oz)/q,6) end;
  elsif r.kind='reversal' then
   select value_delta_cents into reversed_cost from public.inventory_movements where id=r.reverses_id and product_id=m.product_id and recording_order<r.recording_order;
   if not found then raise exception 'Stock reversal order needs review';end if;
   cost:=-reversed_cost;
  end if;
  q:=q+r.quantity_delta_oz;v:=v+cost;
  if q<0 or v<0 or (q=0 and v<>0) then raise exception 'Recalculation would create an invalid stock balance';end if;
  if cost<>r.value_delta_cents then
   insert into public.inventory_cost_changes values(p_request,r.id,r.value_delta_cents,cost);
   update public.inventory_movements set value_delta_cents=cost where id=r.id;
  end if;
 end loop;
 update public.inventory_balances set value_cents=v where product_id=m.product_id;
 -- Include flat-rate/bundled stay invoices, since their profitability changed too.
 insert into public.invoice_feed_cost_flags(correction_id,invoice_id)
 select distinct p_request,i.id from public.invoices i join public.training_stays s on s.id=i.stay_id
 join public.inventory_movements f on f.horse_id=s.horse_id and f.kind='feeding' and f.movement_date between i.period_from and i.period_to
 join public.inventory_cost_changes c on c.movement_id=f.id and c.correction_id=p_request
 where i.status<>'void' and not exists(select 1 from public.inventory_movements rev where rev.reverses_id=f.id)
 union
 select distinct p_request,l.invoice_id from public.invoice_feed_claims fc join public.invoice_lines l on l.id=fc.line_id
 join public.inventory_cost_changes c on c.movement_id=fc.movement_id and c.correction_id=p_request
 join public.invoices i on i.id=l.invoice_id where i.status<>'void';
 return p_request;
end;$$;

-- Keep a single replay engine; public entry points enforce their source type.
revoke all on function public.revalue_inventory_cost(uuid,uuid,integer,integer,text) from public,anon,authenticated;
create or replace function public.revalue_purchase_cost(p_request uuid,p_movement uuid,p_expected integer,p_cost integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if not exists(select 1 from public.inventory_movements where id=p_movement and kind='purchase') then raise exception 'Choose a purchase';end if;
 return public.revalue_inventory_cost(p_request,p_movement,p_expected,p_cost,p_reason);
end;$$;
revoke all on function public.revalue_purchase_cost(uuid,uuid,integer,integer,text) from public,anon;
grant execute on function public.revalue_purchase_cost(uuid,uuid,integer,integer,text) to authenticated;
create function public.revalue_inbound_cost(p_request uuid,p_movement uuid,p_expected integer,p_cost integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if not exists(select 1 from public.inventory_movements where id=p_movement and kind in ('opening','adjustment_in')) then raise exception 'Choose opening stock or a stock addition';end if;
 return public.revalue_inventory_cost(p_request,p_movement,p_expected,p_cost,p_reason);
end;$$;
revoke all on function public.revalue_inbound_cost(uuid,uuid,integer,integer,text) from public,anon;
grant execute on function public.revalue_inbound_cost(uuid,uuid,integer,integer,text) to authenticated;
commit;
