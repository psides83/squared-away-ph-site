begin;

-- Product conversion labels are editable names, not global physical constants.
drop trigger protect_standard_inventory_units on public.inventory_units;
drop function public.protect_standard_inventory_units();
alter table public.inventory_units drop constraint inventory_units_check;
alter table public.inventory_units drop constraint inventory_units_label_check;
alter table public.inventory_units add constraint inventory_unit_name_valid check(label=btrim(label) and length(label) between 1 and 40);
create unique index inventory_units_product_name_unique on public.inventory_units(product_id,lower(label));

-- Expose an exact decimal string for editing without a JavaScript number round-trip.
alter table public.inventory_units add column ounces_per_unit_text text generated always as (ounces_per_unit::text) stored;

-- Retain exact gram arithmetic for existing reference units independently of
-- their names. Once their weight changes, the configured multiplier wins.
alter table public.inventory_units add column metric_basis text check(metric_basis in ('mg','g','kg','tonne'));
update public.inventory_units set metric_basis=label where
  (label='mg' and ounces_per_unit=0.000035273962) or
  (label='g' and ounces_per_unit=0.035273961950) or
  (label='kg' and ounces_per_unit=35.273961949580) or
  (label='tonne' and ounces_per_unit=35273.961949580413);
create function public.inventory_unit_metric_basis() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.product_id is distinct from old.product_id then raise exception 'A conversion must stay with its original product'; end if;
    new.metric_basis:=case when new.ounces_per_unit=old.ounces_per_unit then old.metric_basis else null end;
  else
    new.metric_basis:=case
      when new.label='mg' and new.ounces_per_unit=0.000035273962 then 'mg'
      when new.label='g' and new.ounces_per_unit=0.035273961950 then 'g'
      when new.label='kg' and new.ounces_per_unit=35.273961949580 then 'kg'
      when new.label='tonne' and new.ounces_per_unit=35273.961949580413 then 'tonne'
      else null end;
  end if;
  return new;
end; $$;
revoke all on function public.inventory_unit_metric_basis() from public,anon,authenticated;
create trigger inventory_unit_metric_basis before insert or update on public.inventory_units for each row execute function public.inventory_unit_metric_basis();

create or replace function public.record_stock_movement(
  p_request uuid,p_product uuid,p_unit uuid,p_quantity numeric,p_kind text,p_date date,
  p_cost_cents integer default null,p_horse uuid default null,p_notes text default null,
  p_vendor text default null,p_paid_on date default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare pr public.inventory_products%rowtype; un public.inventory_units%rowtype; bal public.inventory_balances%rowtype;
  qty numeric; cost numeric; move_id uuid; exp_id uuid; existing public.inventory_movements%rowtype;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_request is null or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 or p_quantity<>round(p_quantity,6) or p_date is null then raise exception 'Enter a positive quantity (up to six decimal places) and a date.'; end if;
  if p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Record an actual transaction, not a future date'; end if;
  if p_kind not in ('purchase','opening','feeding','waste','adjustment_in','adjustment_out') or p_kind is null then raise exception 'Invalid stock operation'; end if;
  if p_kind in ('adjustment_in','adjustment_out') and (p_notes is null or length(trim(p_notes))=0) then raise exception 'Enter a stock correction reason'; end if;
  select * into pr from public.inventory_products where id=p_product for update;
  if not found or pr.archived then raise exception 'Choose an active product'; end if;
  select * into existing from public.inventory_movements where request_id=p_request;
  if found then
    if existing.product_id<>p_product or existing.kind<>p_kind or existing.unit_id<>p_unit
      or existing.entered_quantity<>p_quantity or existing.movement_date<>p_date
      or existing.horse_id is distinct from p_horse or existing.notes is distinct from p_notes
      or (p_kind in ('purchase','opening','adjustment_in') and existing.value_delta_cents is distinct from p_cost_cents)
      then raise exception 'This form was already used. Reload before recording another stock transaction.'; end if;
    return jsonb_build_object('movement_id',existing.id,'expense_id',existing.expense_id);
  end if;
  select * into un from public.inventory_units where id=p_unit and product_id=p_product;
  if not found then raise exception 'Choose a unit belonging to this product'; end if;
  -- Preserve exact metric arithmetic only for unchanged reference conversions.
  -- Edited weights use the configured multiplier, regardless of the unit label.
  -- This avoids a shortage caused by multiplying a rounded gram conversion (e.g. 1 kg vs 1,000 g).
  qty := round(case un.metric_basis
    when 'mg' then p_quantity / 28349.523125
    when 'g' then p_quantity / 28.349523125
    when 'kg' then p_quantity * 1000 / 28.349523125
    when 'tonne' then p_quantity * 1000000 / 28.349523125
    else p_quantity * un.ounces_per_unit end,12);
  if qty <= 0 then raise exception 'Quantity is below inventory precision'; end if;
  select * into bal from public.inventory_balances where product_id=p_product;
  if p_kind in ('purchase','opening','adjustment_in') then
    if p_cost_cents is null or p_cost_cents < 0 or p_cost_cents > 100000000 then raise exception 'Enter total stock cost'; end if;
    if p_kind='opening' and exists(select 1 from public.inventory_movements where product_id=p_product) then raise exception 'Opening stock can only be the first movement'; end if;
    cost := p_cost_cents;
    if p_kind='purchase' then
      insert into public.expenses(expense_date,paid_on,category_id,vendor,amount_cents,notes)
        values(p_date,p_paid_on,pr.expense_category_id,p_vendor,p_cost_cents,p_notes) returning id into exp_id;
    end if;
  else
    if p_kind='feeding' and p_horse is null then raise exception 'Select a horse for feeding'; end if;
    if qty>bal.quantity_oz then raise exception 'Not enough stock. Record a purchase or opening stock first.'; end if;
    cost := case when qty=bal.quantity_oz then bal.value_cents else round(bal.value_cents*qty/bal.quantity_oz,6) end;
    qty := -qty; cost := -cost;
  end if;
  update public.inventory_balances set quantity_oz=quantity_oz+qty,value_cents=value_cents+cost where product_id=p_product;
  insert into public.inventory_movements(request_id,product_id,unit_id,horse_id,kind,movement_date,entered_quantity,unit_label,ounces_per_unit,quantity_delta_oz,value_delta_cents,expense_id,notes)
    values(p_request,p_product,p_unit,p_horse,p_kind,p_date,p_quantity,un.label,un.ounces_per_unit,qty,cost,exp_id,p_notes) returning id into move_id;
  return jsonb_build_object('movement_id',move_id,'expense_id',exp_id);
end; $$;


commit;
