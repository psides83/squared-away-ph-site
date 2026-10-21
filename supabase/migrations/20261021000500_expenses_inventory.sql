begin;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 100)
);
create unique index expense_category_name on public.expense_categories(lower(trim(name)));
insert into public.expense_categories(name) values ('Feed'), ('Hay'), ('Supplements'), ('Boarding / facility'), ('Bedding'), ('Vet'), ('Farrier'), ('Hauling'), ('Other');

create table public.expenses (
  id uuid primary key default gen_random_uuid(), expense_date date not null, paid_on date,
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  horse_id uuid references public.horses(id) on delete restrict,
  vendor text check (length(vendor) <= 200), amount_cents integer not null check (amount_cents between 0 and 100000000),
  reimbursable boolean not null default false check (not reimbursable or horse_id is not null), notes text check (length(notes) <= 5000), voided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses(expense_date desc);
create index expenses_horse_idx on public.expenses(horse_id);
create index expenses_category_idx on public.expenses(category_id);
create trigger update_timestamp before update on public.expenses for each row execute function public.set_updated_at();

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 200),
  category text not null check (category in ('feed','hay','supplement')),
  expense_category_id uuid not null references public.expense_categories(id) on delete restrict,
  archived boolean not null default false, created_at timestamptz not null default now()
);
create table public.inventory_units (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.inventory_products(id) on delete restrict,
  label text not null check (label = lower(trim(label)) and length(label) between 1 and 40),
  ounces_per_unit numeric(18,6) not null check (ounces_per_unit > 0 and ounces_per_unit <= 1000000000),
  unique(product_id,label), unique(id,product_id),
  check ((label <> 'oz' or ounces_per_unit = 1) and (label <> 'lb' or ounces_per_unit = 16))
);
create table public.inventory_balances (
  product_id uuid primary key references public.inventory_products(id),
  quantity_oz numeric(20,6) not null default 0 check (quantity_oz >= 0),
  value_cents numeric(24,6) not null default 0 check (value_cents >= 0),
  check (quantity_oz <> 0 or value_cents = 0)
);
create table public.feed_rations (
  id uuid primary key default gen_random_uuid(), horse_id uuid not null references public.horses(id) on delete restrict,
  product_id uuid not null references public.inventory_products(id), unit_id uuid not null,
  quantity numeric(18,6) not null check (quantity > 0 and quantity <= 1000000000),
  notes text check (length(notes) <= 2000), active boolean not null default true,
  unique(horse_id,product_id), foreign key(unit_id,product_id) references public.inventory_units(id,product_id)
);
create table public.feeding_confirmations (
  id uuid primary key default gen_random_uuid(), horse_id uuid not null references public.horses(id),
  feeding_date date not null, created_at timestamptz not null default now(), unique(horse_id,feeding_date)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
  product_id uuid not null references public.inventory_products(id), unit_id uuid not null references public.inventory_units(id), horse_id uuid references public.horses(id),
  kind text not null check (kind in ('purchase','opening','feeding','waste','adjustment_in','adjustment_out','reversal')),
  movement_date date not null, entered_quantity numeric(18,6) not null check (entered_quantity > 0),
  unit_label text not null, ounces_per_unit numeric(18,6) not null check (ounces_per_unit > 0),
  quantity_delta_oz numeric(20,6) not null check (quantity_delta_oz <> 0), value_delta_cents numeric(24,6) not null,
  expense_id uuid unique references public.expenses(id),
  confirmation_id uuid references public.feeding_confirmations(id),
  reverses_id uuid unique references public.inventory_movements(id),
  notes text check (length(notes) <= 5000), created_at timestamptz not null default now(),
  unique(confirmation_id,product_id)
);
create index movements_product_idx on public.inventory_movements(product_id,created_at desc);
create index movements_horse_idx on public.inventory_movements(horse_id,movement_date desc);

do $$ declare t text; begin
  foreach t in array array['expense_categories','expenses','inventory_products','inventory_units','inventory_balances','feed_rations','feeding_confirmations','inventory_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy admin_only on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',t);
  end loop;
end; $$;
grant insert,update,delete on public.expense_categories to authenticated;
grant update(name,category,expense_category_id,archived) on public.inventory_products to authenticated;
grant insert,update,delete on public.inventory_units,public.feed_rations to authenticated;

create function public.save_expense(p_id uuid, p_data jsonb,p_request uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.expenses%rowtype; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  v := jsonb_populate_record(null::public.expenses,p_data);
  if p_id is not null then
    perform 1 from public.expenses where id=p_id and voided_at is null for update;
    if not found then raise exception 'Expense not found'; end if;
    if exists(select 1 from public.inventory_movements where expense_id=p_id) then raise exception 'Purchase costs are retained with stock history. Update payment status or record a separate correction.'; end if;
    update public.expenses set expense_date=v.expense_date,paid_on=v.paid_on,category_id=v.category_id,horse_id=v.horse_id,vendor=v.vendor,amount_cents=v.amount_cents,reimbursable=coalesce(v.reimbursable,false),notes=v.notes where id=p_id;
    return p_id;
  end if;
  p_request:=coalesce(p_request,gen_random_uuid());
  insert into public.expenses(id,expense_date,paid_on,category_id,horse_id,vendor,amount_cents,reimbursable,notes)
    values(p_request,v.expense_date,v.paid_on,v.category_id,v.horse_id,v.vendor,v.amount_cents,coalesce(v.reimbursable,false),v.notes)
    on conflict(id) do nothing;
  if exists(select 1 from public.expenses e where e.id=p_request and
    row(e.expense_date,e.paid_on,e.category_id,e.horse_id,e.vendor,e.amount_cents,e.reimbursable,e.notes)
    is distinct from row(v.expense_date,v.paid_on,v.category_id,v.horse_id,v.vendor,v.amount_cents,coalesce(v.reimbursable,false),v.notes)) then
    raise exception 'This form was already used. Reload before recording another expense.';
  end if;
  return p_request;
end; $$;

create function public.set_expense_status(p_id uuid,p_paid_on date,p_void boolean default false) returns void
language plpgsql security definer set search_path = '' as $$ begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.expenses where id=p_id and voided_at is null for update;
  if not found then raise exception 'Expense not found'; end if;
  if p_void and exists(select 1 from public.inventory_movements where expense_id=p_id) then raise exception 'Stock purchases cannot be voided independently of inventory.'; end if;
  update public.expenses set paid_on=p_paid_on,voided_at=case when p_void then now() else null end where id=p_id;
end; $$;

create function public.create_inventory_product(p_name text,p_category text,p_expense_category uuid) returns uuid
language plpgsql security definer set search_path = '' as $$ declare v_id uuid; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  insert into public.inventory_products(name,category,expense_category_id) values(p_name,p_category,p_expense_category) returning id into v_id;
  insert into public.inventory_balances(product_id) values(v_id);
  insert into public.inventory_units(product_id,label,ounces_per_unit) values(v_id,'oz',1),(v_id,'lb',16);
  return v_id;
end; $$;

-- All stock writes serialize on the product row; clients cannot edit balances or ledger rows.
create function public.record_stock_movement(
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
  qty := round(p_quantity*un.ounces_per_unit,6);
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

create function public.confirm_daily_feeding(p_horse uuid,p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare confirmation uuid; r record; result jsonb; movement uuid;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_date is null or p_date > (now() at time zone 'America/Chicago')::date then raise exception 'Confirm an actual feeding date, not a future date'; end if;
  insert into public.feeding_confirmations(horse_id,feeding_date) values(p_horse,p_date)
    on conflict(horse_id,feeding_date) do nothing returning id into confirmation;
  if confirmation is null then select id into confirmation from public.feeding_confirmations where horse_id=p_horse and feeding_date=p_date; return confirmation; end if;
  if not exists(select 1 from public.feed_rations where horse_id=p_horse and active) then raise exception 'Save an active ration for this horse first'; end if;
  for r in select * from public.feed_rations where horse_id=p_horse and active order by product_id for share loop
    result := public.record_stock_movement(gen_random_uuid(),r.product_id,r.unit_id,r.quantity,'feeding',p_date,null,p_horse,'Confirmed daily ration');
    movement := (result->>'movement_id')::uuid;
    update public.inventory_movements set confirmation_id=confirmation where id=movement;
  end loop;
  return confirmation;
end; $$;

create function public.reverse_stock_consumption(p_movement uuid,p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.inventory_movements%rowtype; reverse_id uuid; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into m from public.inventory_movements where id=p_movement;
  if not found or m.kind not in ('feeding','waste','adjustment_out') then raise exception 'Only consumption, waste, or stock reductions can be reversed here'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 5000 then raise exception 'Enter a correction reason'; end if;
  perform 1 from public.inventory_products where id=m.product_id for update;
  select id into reverse_id from public.inventory_movements where reverses_id=m.id;
  if found then return reverse_id; end if;
  update public.inventory_balances set quantity_oz=quantity_oz-m.quantity_delta_oz,value_cents=value_cents-m.value_delta_cents where product_id=m.product_id;
  insert into public.inventory_movements(request_id,product_id,unit_id,horse_id,kind,movement_date,entered_quantity,unit_label,ounces_per_unit,quantity_delta_oz,value_delta_cents,reverses_id,notes)
    values(gen_random_uuid(),m.product_id,m.unit_id,m.horse_id,'reversal',(now() at time zone 'America/Chicago')::date,m.entered_quantity,m.unit_label,m.ounces_per_unit,-m.quantity_delta_oz,-m.value_delta_cents,m.id,p_reason) returning id into reverse_id;
  return reverse_id;
end; $$;

revoke all on function public.save_expense(uuid,jsonb,uuid),public.set_expense_status(uuid,date,boolean),public.create_inventory_product(text,text,uuid),public.record_stock_movement(uuid,uuid,uuid,numeric,text,date,integer,uuid,text,text,date),public.confirm_daily_feeding(uuid,date),public.reverse_stock_consumption(uuid,text) from public;
grant execute on function public.save_expense(uuid,jsonb,uuid),public.set_expense_status(uuid,date,boolean),public.create_inventory_product(text,text,uuid),public.record_stock_movement(uuid,uuid,uuid,numeric,text,date,integer,uuid,text,text,date),public.confirm_daily_feeding(uuid,date),public.reverse_stock_consumption(uuid,text) to authenticated;

commit;
