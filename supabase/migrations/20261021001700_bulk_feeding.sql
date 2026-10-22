create or replace function public.confirm_daily_feeding(p_horse uuid,p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare confirmation uuid; r record; result jsonb; movement uuid;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_date is null or p_date > (now() at time zone 'America/Chicago')::date then raise exception 'Confirm an actual feeding date, not a future date'; end if;
  perform id from public.horses where id=p_horse for no key update;
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

-- Each batch is one transaction; any invalid row or shortage rolls back every horse.
create function public.confirm_bulk_daily_feeding(p_horses uuid[], p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare horse uuid; count_saved integer := 0;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_horses is null or cardinality(p_horses) not between 1 and 100
    or exists(select 1 from unnest(p_horses) h where h is null)
    or (select count(distinct h) from unnest(p_horses) h) <> cardinality(p_horses)
    then raise exception 'Choose between 1 and 100 different horses'; end if;
  perform id from public.horses where id=any(p_horses) order by id for no key update;
  -- Every batch and single-horse ration locks shared products in the same order.
  perform p.id from public.inventory_products p where p.id in
    (select r.product_id from public.feed_rations r where r.horse_id=any(p_horses) and r.active)
    order by p.id for update;
  for horse in select h from unnest(p_horses) h order by h loop
    perform public.confirm_daily_feeding(horse,p_date);
    count_saved := count_saved + 1;
  end loop;
  return count_saved;
end; $$;
revoke all on function public.confirm_bulk_daily_feeding(uuid[],date) from public,anon;
grant execute on function public.confirm_bulk_daily_feeding(uuid[],date) to authenticated;

create table public.feeding_entry_batches (
  request_id uuid primary key,
  batch_data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.feeding_entry_batches enable row level security;
create policy admin_feeding_batches on public.feeding_entry_batches for select to authenticated using (public.is_admin());
grant select on public.feeding_entry_batches to authenticated;

create function public.record_bulk_extra_feeding(p_request uuid,p_product uuid,p_unit uuid,p_date date,p_entries jsonb,p_notes text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare entry record; count_saved integer := 0; payload jsonb; saved jsonb; claimed uuid;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_request is null or p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'Choose horses and enter their quantities'; end if;
  if jsonb_array_length(p_entries) not between 1 and 100 then raise exception 'Enter between 1 and 100 feeding rows'; end if;
  if p_notes is not null and length(p_notes)>5000 then raise exception 'Notes must be at most 5,000 characters'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries) as e(horse_id uuid,quantity numeric) where horse_id is null or quantity is null)
    or (select count(distinct horse_id) from jsonb_to_recordset(p_entries) as e(horse_id uuid)) <> jsonb_array_length(p_entries)
    then raise exception 'Each horse needs one quantity and may appear only once'; end if;
  payload := jsonb_build_object('product',p_product,'unit',p_unit,'date',p_date,'notes',p_notes,
    'entries',(select jsonb_agg(to_jsonb(e) order by e.horse_id) from jsonb_to_recordset(p_entries) as e(horse_id uuid,quantity numeric)));
  insert into public.feeding_entry_batches(request_id,batch_data) values(p_request,payload)
    on conflict(request_id) do nothing returning request_id into claimed;
  if claimed is null then
    select batch_data into saved from public.feeding_entry_batches where request_id=p_request for update;
    if saved is distinct from payload then raise exception 'This batch was already used. Reload before recording changed entries.'; end if;
    return jsonb_array_length(p_entries);
  end if;
  for entry in select * from jsonb_to_recordset(p_entries) as e(horse_id uuid,quantity numeric) order by horse_id loop
    -- Stable IDs make re-submitting the same batch safe; edited retries are rejected.
    perform public.record_stock_movement(md5(p_request::text || entry.horse_id::text)::uuid,
      p_product,p_unit,entry.quantity,'feeding',p_date,null,entry.horse_id,p_notes);
    count_saved := count_saved + 1;
  end loop;
  return count_saved;
end; $$;
revoke all on function public.record_bulk_extra_feeding(uuid,uuid,uuid,date,jsonb,text) from public,anon;
grant execute on function public.record_bulk_extra_feeding(uuid,uuid,uuid,date,jsonb,text) to authenticated;
