begin;
alter table public.inventory_cost_corrections add column old_quantity numeric(18,6),add column new_quantity numeric(18,6),add column unit_label text,add column ounces_per_unit numeric(18,6);
-- Earlier corrections changed costs only; their recorded source quantities stayed fixed.
update public.inventory_cost_corrections c set old_quantity=m.entered_quantity,new_quantity=m.entered_quantity,unit_label=m.unit_label,ounces_per_unit=m.ounces_per_unit from public.inventory_movements m where m.id=c.movement_id;
alter table public.inventory_cost_corrections alter column old_quantity set not null,alter column new_quantity set not null,alter column unit_label set not null,alter column ounces_per_unit set not null;
alter table public.inventory_cost_corrections add check(old_quantity>0 and new_quantity>0 and ounces_per_unit>0);
create function public.replay_inventory_source_correction(p_request uuid,p_movement uuid,p_expected integer,p_cost integer,p_expected_quantity numeric,p_quantity numeric,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.inventory_movements;r public.inventory_movements;prior public.inventory_cost_corrections;
 q numeric:=0;v numeric:=0;cost numeric;reversed_cost numeric;balance public.inventory_balances;corrected_oz numeric;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_movement is null or p_expected is null or p_cost is null or p_cost not between 0 and 100000000 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter the corrected cost and a reason';end if;
 if p_expected_quantity is null or p_quantity is null or p_expected_quantity<=0 or p_quantity<=0 or p_quantity>1000000000 or p_quantity<>round(p_quantity,6) then raise exception 'Enter a positive quantity with up to six decimal places';end if;
 select * into m from public.inventory_movements where id=p_movement;
 if not found or m.kind not in ('purchase','opening','adjustment_in') then raise exception 'Choose a purchase, opening stock or stock addition';end if;
 perform 1 from public.inventory_products where id=m.product_id for update;
 select * into prior from public.inventory_cost_corrections where id=p_request;
 if found then
  if row(prior.movement_id,prior.old_cost_cents,prior.new_cost_cents,prior.old_quantity,prior.new_quantity,prior.reason) is distinct from row(p_movement,p_expected,p_cost,p_expected_quantity,p_quantity,trim(p_reason)) then raise exception 'This correction form was already used. Reload';end if;
  return prior.id;
 end if;
 select * into m from public.inventory_movements where id=p_movement;
 if m.value_delta_cents<>p_expected then raise exception 'This stock cost changed. Reload before correcting it';end if;
 if m.entered_quantity<>p_expected_quantity then raise exception 'This stock quantity changed. Reload before correcting it';end if;
 if p_cost=p_expected and p_quantity=p_expected_quantity then raise exception 'Enter a different quantity or cost';end if;
 corrected_oz:=round(p_quantity*m.ounces_per_unit,6);
 if corrected_oz<=0 or corrected_oz>=100000000000000 then raise exception 'The corrected weight is outside the supported stock range';end if;
 if round(m.entered_quantity*m.ounces_per_unit,6)<>m.quantity_delta_oz then raise exception 'The recorded quantity and conversion do not reconcile. Review this stock entry first';end if;
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
  if p_cost<>p_expected then update public.expenses set amount_cents=p_cost where id=m.expense_id;end if;
 elsif m.expense_id is not null then raise exception 'This stock addition has an unexpected expense link. Review it first';
 end if;
 insert into public.inventory_cost_corrections(id,movement_id,old_cost_cents,new_cost_cents,reason,created_by,old_quantity,new_quantity,unit_label,ounces_per_unit)
 values(p_request,m.id,p_expected,p_cost,trim(p_reason),auth.uid(),m.entered_quantity,p_quantity,m.unit_label,m.ounces_per_unit);
 update public.inventory_movements set entered_quantity=p_quantity,quantity_delta_oz=corrected_oz where id=m.id;
 for r in select * from public.inventory_movements where product_id=m.product_id order by recording_order loop
  cost:=r.value_delta_cents;
  if r.id=m.id then cost:=p_cost;
  elsif r.kind in ('feeding','waste','adjustment_out') then
   if q<=0 or -r.quantity_delta_oz>q then raise exception 'Correction blocked: stock would be short by % oz at % on % (record %). Review earlier stock records before retrying. No adjustment was created.',-r.quantity_delta_oz-q,r.kind,r.movement_date,r.id;end if;
   cost:=case when -r.quantity_delta_oz=q then -v else -round(v*(-r.quantity_delta_oz)/q,6) end;
  elsif r.kind='reversal' then
   select value_delta_cents into reversed_cost from public.inventory_movements where id=r.reverses_id and product_id=m.product_id and recording_order<r.recording_order;
   if not found then raise exception 'Stock reversal order needs review';end if;
   cost:=-reversed_cost;
  end if;
  q:=q+r.quantity_delta_oz;v:=v+cost;
  if q<0 then raise exception 'Correction blocked: stock would be short by % oz at % on % (record %). Review earlier stock records before retrying. No adjustment was created.',-q,r.kind,r.movement_date,r.id;end if;
  if v<0 or (q=0 and v<>0) then raise exception 'Recalculation would create an invalid stock balance at record %. Review the source values before retrying.',r.id;end if;
  if cost<>r.value_delta_cents then
   insert into public.inventory_cost_changes values(p_request,r.id,r.value_delta_cents,cost);
   update public.inventory_movements set value_delta_cents=cost where id=r.id;
  end if;
 end loop;
 update public.inventory_balances set quantity_oz=q,value_cents=v where product_id=m.product_id;
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


revoke all on function public.replay_inventory_source_correction(uuid,uuid,integer,integer,numeric,numeric,text) from public,anon,authenticated;
-- Cost-only callers never change quantities and retain late retry behavior.
create or replace function public.revalue_inventory_cost(p_request uuid,p_movement uuid,p_expected integer,p_cost integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.inventory_movements;prior public.inventory_cost_corrections;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into m from public.inventory_movements where id=p_movement;
 if not found or m.kind not in ('purchase','opening','adjustment_in') then raise exception 'Choose a purchase, opening stock or stock addition';end if;
 perform 1 from public.inventory_products where id=m.product_id for update;
 select * into prior from public.inventory_cost_corrections where id=p_request;
 if found then
  if row(prior.movement_id,prior.old_cost_cents,prior.new_cost_cents,prior.reason) is distinct from row(p_movement,p_expected,p_cost,trim(p_reason)) or prior.old_quantity<>prior.new_quantity then raise exception 'This correction form was already used. Reload';end if;
  return prior.id;
 end if;
 select * into m from public.inventory_movements where id=p_movement;
 return public.replay_inventory_source_correction(p_request,p_movement,p_expected,p_cost,m.entered_quantity,m.entered_quantity,p_reason);
end;$$;
revoke all on function public.revalue_inventory_cost(uuid,uuid,integer,integer,text) from public,anon,authenticated;
create function public.correct_inventory_source_quantity(p_request uuid,p_movement uuid,p_expected_cost integer,p_cost integer,p_expected_quantity numeric,p_quantity numeric,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 return public.replay_inventory_source_correction(p_request,p_movement,p_expected_cost,p_cost,p_expected_quantity,p_quantity,p_reason);
end;$$;
revoke all on function public.correct_inventory_source_quantity(uuid,uuid,integer,integer,numeric,numeric,text) from public,anon;
grant execute on function public.correct_inventory_source_quantity(uuid,uuid,integer,integer,numeric,numeric,text) to authenticated;
commit;
