begin;
create table public.inventory_receipt_purchases (
 id uuid primary key references public.expenses(id),payload jsonb not null,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancel_reason text
);
alter table public.inventory_movements drop constraint inventory_movements_expense_id_key;
create index movements_expense_idx on public.inventory_movements(expense_id);
alter table public.inventory_movements add column receipt_purchase_id uuid references public.inventory_receipt_purchases(id);
create table public.inventory_receipt_lines (
 id uuid primary key,receipt_id uuid not null references public.inventory_receipt_purchases(id),position integer not null,
 description text not null,kind text not null check(kind in ('inventory','expense')),
 subtotal_cents integer not null check(subtotal_cents between 0 and 100000000),discount_cents integer not null check(discount_cents between 0 and subtotal_cents),tax_cents integer not null check(tax_cents between 0 and 100000000),
 total_cents integer generated always as(subtotal_cents-discount_cents+tax_cents) stored,
 movement_id uuid unique references public.inventory_movements(id),product_name text,quantity numeric,unit_label text,ounces_per_unit numeric,
 unique(receipt_id,position)
);
do $$ declare t text;begin
 foreach t in array array['inventory_receipt_purchases','inventory_receipt_lines'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using(public.is_admin())',t);
 end loop;
end;$$;
create function public.record_receipt_purchase(p_request uuid,p_header jsonb,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.inventory_receipt_purchases;e public.expenses;r jsonb;pr public.inventory_products;movement public.inventory_movements;
 payload jsonb;sub bigint:=0;disc bigint:=0;tax bigint:=0;total bigint:=0;amount integer;discount integer;line_tax integer;line_id uuid;result jsonb;n integer:=0;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or jsonb_typeof(p_header) is distinct from 'object' or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Enter receipt details and items';end if;
 if jsonb_array_length(p_lines) not between 1 and 20 or pg_column_size(p_header)+pg_column_size(p_lines)>60000 then raise exception 'Enter 1 to 20 receipt items';end if;
 payload:=jsonb_build_object('header',p_header,'lines',p_lines);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,741853170));
 select * into prior from public.inventory_receipt_purchases where id=p_request;
 if found then
  if prior.payload is distinct from payload then raise exception 'This receipt form was already used. Reload before entering a different purchase';end if;
  return prior.id;
 end if;
 e.expense_date:=(p_header->>'expense_date')::date;e.paid_on:=nullif(p_header->>'paid_on','')::date;
 e.category_id:=(p_header->>'category_id')::uuid;e.vendor:=trim(p_header->>'vendor');e.notes:=nullif(trim(p_header->>'notes'),'');
 if e.expense_date is null or e.expense_date>(now() at time zone 'America/Chicago')::date or e.paid_on>(now() at time zone 'America/Chicago')::date then raise exception 'Choose actual purchase/payment dates';end if;
 if e.vendor is null or length(e.vendor) not between 1 and 200 or length(e.notes)>5000 then raise exception 'Enter a vendor and valid notes';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'Receipt item identifiers must be unique';end if;
 -- Lock all products in the same order before updating any stock.
 perform 1 from public.inventory_products where id in(select (x->>'product_id')::uuid from jsonb_array_elements(p_lines) x where x->>'kind'='inventory') order by id for update;
 for r in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(r) is distinct from 'object' or r->>'kind' is null or r->>'kind' not in ('inventory','expense') or r->>'description' is null or length(trim(r->>'description')) not between 1 and 200 then raise exception 'Each item needs a type and description';end if;
  line_id:=(r->>'id')::uuid;
  if line_id is null or exists(select 1 from public.inventory_movements where request_id=line_id) then raise exception 'This receipt item identifier was already used';end if;
  amount:=(r->>'subtotal_cents')::integer;discount:=(r->>'discount_cents')::integer;line_tax:=(r->>'tax_cents')::integer;
  if amount is null or discount is null or line_tax is null or amount not between 0 and 100000000 or discount not between 0 and amount or line_tax not between 0 and 100000000 then raise exception 'Review each item subtotal, discount and tax';end if;
  sub:=sub+amount;disc:=disc+discount;tax:=tax+line_tax;total:=total+amount-discount+line_tax;
 end loop;
 if total>100000000 or (p_header->>'total_cents')::bigint is distinct from total or (p_header->>'discount_cents')::bigint is distinct from disc or (p_header->>'tax_cents')::bigint is distinct from tax then raise exception 'Item costs, discount, tax and receipt total must reconcile exactly';end if;
 insert into public.expenses(id,expense_date,paid_on,category_id,vendor,amount_cents,notes) values(p_request,e.expense_date,e.paid_on,e.category_id,e.vendor,total,e.notes);
 insert into public.inventory_receipt_purchases(id,payload,created_by) values(p_request,payload,auth.uid());
 for r in select value from jsonb_array_elements(p_lines) loop
  n:=n+1;movement:=null;pr:=null;line_id:=(r->>'id')::uuid;
  if r->>'kind'='inventory' then
   select * into pr from public.inventory_products where id=(r->>'product_id')::uuid;
   -- Reuse canonical metric conversion and stock validation, without creating another expense.
   result:=public.record_stock_movement(line_id,pr.id,(r->>'unit_id')::uuid,(r->>'quantity')::numeric,'adjustment_in',e.expense_date,(r->>'subtotal_cents')::integer-(r->>'discount_cents')::integer+(r->>'tax_cents')::integer,null,'Receipt purchase: '||trim(r->>'description'));
   update public.inventory_movements set kind='purchase',expense_id=p_request,receipt_purchase_id=p_request where id=(result->>'movement_id')::uuid returning * into movement;
  elsif nullif(r->>'product_id','') is not null or nullif(r->>'unit_id','') is not null or nullif(r->>'quantity','') is not null then raise exception 'Expense-only items cannot add inventory';
  end if;
  insert into public.inventory_receipt_lines(id,receipt_id,position,description,kind,subtotal_cents,discount_cents,tax_cents,movement_id,product_name,quantity,unit_label,ounces_per_unit)
  values(line_id,p_request,n,trim(r->>'description'),r->>'kind',(r->>'subtotal_cents')::integer,(r->>'discount_cents')::integer,(r->>'tax_cents')::integer,movement.id,pr.name,movement.entered_quantity,movement.unit_label,movement.ounces_per_unit);
 end loop;
 return p_request;
end;$$;
revoke all on function public.record_receipt_purchase(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.record_receipt_purchase(uuid,jsonb,jsonb) to authenticated;
-- Single-purchase correction tools must never overwrite the whole receipt or its retained item snapshots.
create function public.guard_receipt_purchase() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='inventory_movements' then
  if old.receipt_purchase_id is not null and new is distinct from old then raise exception 'Multi-item receipt stock is retained. Cancel the untouched whole receipt or use a future reviewed receipt correction';end if;
 elsif exists(select 1 from public.inventory_receipt_purchases where id=old.id) then
  if row(new.expense_date,new.category_id,new.horse_id,new.vendor,new.amount_cents,new.reimbursable) is distinct from row(old.expense_date,old.category_id,old.horse_id,old.vendor,old.amount_cents,old.reimbursable) or (new.voided_at is distinct from old.voided_at and not exists(select 1 from public.inventory_receipt_purchases where id=old.id and cancelled_at is not null)) then raise exception 'Receipt totals and items are retained. Use whole-receipt cancellation; payment status can still be updated';end if;
 end if;
 return new;
end;$$;
revoke all on function public.guard_receipt_purchase() from public,anon,authenticated;
create trigger protect_receipt_stock before update on public.inventory_movements for each row execute function public.guard_receipt_purchase();
create trigger protect_receipt_expense before update on public.expenses for each row execute function public.guard_receipt_purchase();
create function public.cancel_receipt_purchase(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare receipt public.inventory_receipt_purchases;m public.inventory_movements;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a cancellation reason';end if;
 perform 1 from public.inventory_products where id in(select product_id from public.inventory_movements where receipt_purchase_id=p_id) order by id for update;
 perform 1 from public.expenses where id=p_id for update;
 select * into receipt from public.inventory_receipt_purchases where id=p_id for update;
 if not found then raise exception 'Receipt purchase not found';end if;
 if receipt.cancelled_at is not null then return;end if;
 if exists(select 1 from public.inventory_movements later where later.product_id in(select product_id from public.inventory_movements where receipt_purchase_id=p_id) and later.recording_order>=(select min(first.recording_order) from public.inventory_movements first where first.receipt_purchase_id=p_id and first.product_id=later.product_id) and later.receipt_purchase_id is distinct from p_id) then raise exception 'Stock activity followed this receipt. Cancellation is blocked until a reviewed correction workflow can reconcile it';end if;
 update public.inventory_receipt_purchases set cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=trim(p_reason) where id=p_id;
 update public.expenses set voided_at=now() where id=p_id;
 for m in select * from public.inventory_movements where receipt_purchase_id=p_id and kind='purchase' order by recording_order loop
  update public.inventory_balances set quantity_oz=quantity_oz-m.quantity_delta_oz,value_cents=value_cents-m.value_delta_cents where product_id=m.product_id;
  insert into public.inventory_movements(request_id,product_id,unit_id,kind,movement_date,entered_quantity,unit_label,ounces_per_unit,quantity_delta_oz,value_delta_cents,reverses_id,notes,receipt_purchase_id)
   values(gen_random_uuid(),m.product_id,m.unit_id,'reversal',(now() at time zone 'America/Chicago')::date,m.entered_quantity,m.unit_label,m.ounces_per_unit,-m.quantity_delta_oz,-m.value_delta_cents,m.id,'Cancelled receipt: '||trim(p_reason),p_id);
 end loop;
end;$$;
revoke all on function public.cancel_receipt_purchase(uuid,text) from public,anon;
grant execute on function public.cancel_receipt_purchase(uuid,text) to authenticated;
commit;
