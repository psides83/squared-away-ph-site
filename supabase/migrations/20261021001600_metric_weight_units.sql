-- Expand weight precision without changing saved transaction conversions or costs.
alter table public.inventory_units alter column ounces_per_unit type numeric(24,12);
alter table public.inventory_balances alter column quantity_oz type numeric(32,12);
alter table public.inventory_movements alter column ounces_per_unit type numeric(24,12), alter column quantity_delta_oz type numeric(32,12);

-- Preserve pre-existing custom metric names, IDs, ration references, and conversion snapshots.
update public.inventory_units set label = 'legacy-' || replace(id::text,'-','')
where label in ('mg','g','kg','ton','tonne');

create function public.add_standard_inventory_units() returns trigger
language plpgsql security definer set search_path = '' as $$ begin
  insert into public.inventory_units(product_id,label,ounces_per_unit) values
    (new.id,'mg',0.000035273962),(new.id,'g',0.035273961950),
    (new.id,'kg',35.273961949580),(new.id,'ton',32000),(new.id,'tonne',35273.961949580413);
  return new;
end; $$;
create trigger add_standard_inventory_units after insert on public.inventory_products
for each row execute function public.add_standard_inventory_units();
insert into public.inventory_units(product_id,label,ounces_per_unit)
select p.id,u.label,u.ounces from public.inventory_products p cross join
(values ('mg',0.000035273962),('g',0.035273961950),('kg',35.273961949580),('ton',32000),('tonne',35273.961949580413)) u(label,ounces);

create function public.protect_standard_inventory_units() returns trigger
language plpgsql set search_path = '' as $$
declare expected numeric; begin
  if tg_op in ('UPDATE','DELETE') and old.label in ('oz','lb','mg','g','kg','ton','tonne') then
    raise exception 'Standard weight units are fixed. Use a custom serving unit instead.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  expected := case new.label when 'oz' then 1 when 'lb' then 16 when 'mg' then 0.000035273962 when 'g' then 0.035273961950 when 'kg' then 35.273961949580 when 'ton' then 32000 when 'tonne' then 35273.961949580413 end;
  if expected is not null and new.ounces_per_unit <> expected then
    raise exception 'Standard weight units are fixed. Use a custom serving unit instead.';
  end if;
  return new;
end; $$;
create trigger protect_standard_inventory_units before insert or update or delete on public.inventory_units
for each row execute function public.protect_standard_inventory_units();

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
  -- Convert metric weights from the exact international ounce definition.
  -- This avoids a shortage caused by multiplying a rounded gram conversion (e.g. 1 kg vs 1,000 g).
  qty := round(case un.label
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

