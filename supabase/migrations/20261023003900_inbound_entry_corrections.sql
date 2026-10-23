begin;
create table public.inventory_inbound_corrections (
 id uuid primary key,original_id uuid not null unique references public.inventory_movements(id),
 reversal_id uuid not null unique references public.inventory_movements(id),replacement_id uuid not null unique references public.inventory_movements(id),

 unit_id uuid not null references public.inventory_units(id),quantity numeric not null,cost_cents integer not null,
 reason text not null check(length(trim(reason)) between 1 and 2000),created_at timestamptz not null default now(),created_by uuid not null references auth.users(id)
);
alter table public.inventory_inbound_corrections enable row level security;
revoke all on public.inventory_inbound_corrections from public,anon,authenticated;
grant select on public.inventory_inbound_corrections to authenticated;
create policy admin_read on public.inventory_inbound_corrections for select to authenticated using(public.is_admin());
create function public.correct_inventory_inbound(p_request uuid,p_original uuid,p_unit uuid,p_quantity numeric,p_cost_cents integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.inventory_movements;b public.inventory_balances;old public.inventory_inbound_corrections;
 reversal uuid;replacement jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_original is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a correction reason and reload the stock entry';end if;
 select * into m from public.inventory_movements where id=p_original;
 if not found or m.kind not in ('opening','adjustment_in') or m.expense_id is not null then raise exception 'Choose opening stock or a stock addition';end if;
 -- Use the same product lock as consumption/purchases before touching its balance.
 perform 1 from public.inventory_products where id=m.product_id for update;
 select * into old from public.inventory_inbound_corrections where id=p_request;
 if found then
  if row(old.original_id,old.unit_id,old.quantity,old.cost_cents,old.reason) is distinct from row(p_original,p_unit,p_quantity,p_cost_cents,trim(p_reason)) then raise exception 'This correction form was already used. Reload before continuing';end if;
  return old.replacement_id;
 end if;
 if exists(select 1 from public.inventory_movements where reverses_id=m.id) then raise exception 'This stock entry has already been corrected';end if;
 -- Equal timestamps are conservatively blocked because recording order is ambiguous.
 if exists(select 1 from public.inventory_movements where product_id=m.product_id and id<>m.id and created_at>=m.created_at and not exists(select 1 from public.inventory_inbound_corrections c where c.replacement_id=m.id and c.reversal_id=public.inventory_movements.id)) then raise exception 'Stock activity was recorded after this stock entry. Its saved costs must be retained; this entry cannot be replaced';end if;
 select * into b from public.inventory_balances where product_id=m.product_id;
 if b.quantity_oz<m.quantity_delta_oz or b.value_cents<m.value_delta_cents then raise exception 'The stock entry cannot be removed from current stock';end if;
 update public.inventory_balances set quantity_oz=quantity_oz-m.quantity_delta_oz,value_cents=value_cents-m.value_delta_cents where product_id=m.product_id;
 insert into public.inventory_movements(request_id,product_id,unit_id,kind,movement_date,entered_quantity,unit_label,ounces_per_unit,quantity_delta_oz,value_delta_cents,reverses_id,notes)
 values(gen_random_uuid(),m.product_id,m.unit_id,'reversal',(now() at time zone 'America/Chicago')::date,m.entered_quantity,m.unit_label,m.ounces_per_unit,-m.quantity_delta_oz,-m.value_delta_cents,m.id,'Stock entry correction: '||trim(p_reason)) returning id into reversal;
 replacement:=public.record_stock_movement(p_request,m.product_id,p_unit,p_quantity,'adjustment_in',m.movement_date,p_cost_cents,null,'Corrected '||m.kind||' entry: '||trim(p_reason));
 insert into public.inventory_inbound_corrections(id,original_id,reversal_id,replacement_id,unit_id,quantity,cost_cents,reason,created_by)
 values(p_request,m.id,reversal,(replacement->>'movement_id')::uuid,p_unit,p_quantity,p_cost_cents,trim(p_reason),auth.uid());
 return (replacement->>'movement_id')::uuid;
end;$$;
revoke all on function public.correct_inventory_inbound(uuid,uuid,uuid,numeric,integer,text) from public,anon;
grant execute on function public.correct_inventory_inbound(uuid,uuid,uuid,numeric,integer,text) to authenticated;
commit;
