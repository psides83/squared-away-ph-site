create table public.feeding_times (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name=trim(name) and length(name) between 1 and 60),
  time_of_day time, sort_order integer not null default 0 check(sort_order between 0 and 1000),
  archived boolean not null default false
);
create unique index feeding_times_name_unique on public.feeding_times(lower(name));
alter table public.feeding_times enable row level security;
revoke all on public.feeding_times from anon,authenticated;
grant select,insert,update on public.feeding_times to authenticated;
create policy admin_only on public.feeding_times for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.feeding_times(name,sort_order) values ('Morning',10),('Evening',20);

-- Old ration amounts are whole-day totals: never guess an AM/PM split.
alter table public.feed_rations add column feeding_time_id uuid references public.feeding_times(id);
alter table public.feed_rations drop constraint feed_rations_horse_id_product_id_key;
alter table public.feed_rations add constraint feed_rations_horse_product_time_key unique nulls not distinct(horse_id,product_id,feeding_time_id);
alter table public.feeding_confirmations add column feeding_time_id uuid references public.feeding_times(id), add column feeding_time_label text;
alter table public.feeding_confirmations drop constraint feeding_confirmations_horse_id_feeding_date_key;
alter table public.feeding_confirmations add constraint feeding_confirmations_horse_date_time_key unique nulls not distinct(horse_id,feeding_date,feeding_time_id);
alter table public.inventory_movements add column feeding_time_id uuid references public.feeding_times(id), add column feeding_time_label text;

create function public.guard_feeding_time() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_table_name='feeding_times' then
    if new.archived and exists(select 1 from public.feed_rations where feeding_time_id=new.id and active) then raise exception 'Move or pause active rations before archiving this feeding time'; end if;
  elsif new.active and new.feeding_time_id is not null then
    perform id from public.feeding_times where id=new.feeding_time_id and not archived for share;
    if not found then raise exception 'Choose an active feeding time'; end if;
  end if;
  return new;
end; $$;
create trigger guard_feeding_time before update on public.feeding_times for each row execute function public.guard_feeding_time();
create trigger guard_ration_feeding_time before insert or update on public.feed_rations for each row execute function public.guard_feeding_time();

create function public.confirm_scheduled_feeding(p_horse uuid,p_date date,p_feeding_time uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare confirmation uuid; r record; result jsonb; label text := 'Daily total (legacy)';
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Confirm an actual feeding date, not a future date'; end if;
  perform id from public.horses where id=p_horse for no key update;
  select id into confirmation from public.feeding_confirmations where horse_id=p_horse and feeding_date=p_date and feeding_time_id is not distinct from p_feeding_time;
  if found then return confirmation; end if;
  if p_feeding_time is not null then
    if exists(select 1 from public.feeding_confirmations where horse_id=p_horse and feeding_date=p_date and feeding_time_id is null) then raise exception 'A full-day feeding was already confirmed for this horse and date. Review its records before adding a timed feeding'; end if;
    if exists(select 1 from public.feed_rations where horse_id=p_horse and active and feeding_time_id is null) then raise exception 'Assign all active daily totals to feeding times before confirming a scheduled feeding'; end if;
    select name into label from public.feeding_times where id=p_feeding_time and not archived;
    if not found then raise exception 'Choose an active feeding time'; end if;
  else
    if exists(select 1 from public.feed_rations where horse_id=p_horse and active and feeding_time_id is not null)
      or exists(select 1 from public.feeding_confirmations where horse_id=p_horse and feeding_date=p_date and feeding_time_id is not null)
      then raise exception 'Choose a feeding time instead of confirming a whole day'; end if;
  end if;
  if not exists(select 1 from public.feed_rations where horse_id=p_horse and active and feeding_time_id is not distinct from p_feeding_time) then raise exception 'Save an active ration for this horse and feeding time first'; end if;
  insert into public.feeding_confirmations(horse_id,feeding_date,feeding_time_id,feeding_time_label) values(p_horse,p_date,p_feeding_time,label) returning id into confirmation;
  for r in select * from public.feed_rations where horse_id=p_horse and active and feeding_time_id is not distinct from p_feeding_time order by product_id for share loop
    result := public.record_stock_movement(gen_random_uuid(),r.product_id,r.unit_id,r.quantity,'feeding',p_date,null,p_horse,'Confirmed ration: '||label);
    update public.inventory_movements set confirmation_id=confirmation,feeding_time_id=p_feeding_time,feeding_time_label=label where id=(result->>'movement_id')::uuid;
  end loop;
  return confirmation;
end; $$;
revoke all on function public.confirm_scheduled_feeding(uuid,date,uuid) from public,anon;
grant execute on function public.confirm_scheduled_feeding(uuid,date,uuid) to authenticated;
create or replace function public.confirm_daily_feeding(p_horse uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$ begin
  return public.confirm_scheduled_feeding(p_horse,p_date,null);
end; $$;

create function public.confirm_bulk_scheduled_feeding(p_horses uuid[],p_date date,p_feeding_time uuid) returns integer
language plpgsql security definer set search_path='' as $$ declare horse uuid; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_horses is null or cardinality(p_horses) not between 1 and 100
    or exists(select 1 from unnest(p_horses) h where h is null)
    or (select count(distinct h) from unnest(p_horses) h)<>cardinality(p_horses) then raise exception 'Choose between 1 and 100 different horses'; end if;
  perform id from public.horses where id=any(p_horses) order by id for no key update;
  perform id from public.inventory_products where id in(select product_id from public.feed_rations where horse_id=any(p_horses) and active and feeding_time_id is not distinct from p_feeding_time) order by id for update;
  for horse in select h from unnest(p_horses) h order by h loop
    perform public.confirm_scheduled_feeding(horse,p_date,p_feeding_time);
  end loop;
  return cardinality(p_horses);
end; $$;
revoke all on function public.confirm_bulk_scheduled_feeding(uuid[],date,uuid) from public,anon;
grant execute on function public.confirm_bulk_scheduled_feeding(uuid[],date,uuid) to authenticated;
create or replace function public.confirm_bulk_daily_feeding(p_horses uuid[],p_date date) returns integer language plpgsql security definer set search_path='' as $$ begin
  return public.confirm_bulk_scheduled_feeding(p_horses,p_date,null);
end; $$;

drop function public.record_bulk_extra_feeding(uuid,uuid,uuid,date,jsonb,text);
create function public.record_bulk_extra_feeding(p_request uuid,p_product uuid,p_unit uuid,p_date date,p_entries jsonb,p_notes text default null,p_feeding_time uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare entry record; count_saved integer := 0; payload jsonb; saved jsonb; claimed uuid; label text;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_request is null or p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'Choose horses and enter their quantities'; end if;
  if jsonb_array_length(p_entries) not between 1 and 100 then raise exception 'Enter between 1 and 100 feeding rows'; end if;
  if p_notes is not null and length(p_notes)>5000 then raise exception 'Notes must be at most 5,000 characters'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries) as e(horse_id uuid,quantity numeric) where horse_id is null or quantity is null)
    or (select count(distinct horse_id) from jsonb_to_recordset(p_entries) as e(horse_id uuid)) <> jsonb_array_length(p_entries)
    then raise exception 'Each horse needs one quantity and may appear only once'; end if;
  payload := jsonb_build_object('product',p_product,'unit',p_unit,'date',p_date,'notes',p_notes,'feeding_time',p_feeding_time,
    'entries',(select jsonb_agg(to_jsonb(e) order by e.horse_id) from jsonb_to_recordset(p_entries) as e(horse_id uuid,quantity numeric)));
  insert into public.feeding_entry_batches(request_id,batch_data) values(p_request,payload)
    on conflict(request_id) do nothing returning request_id into claimed;
  if claimed is null then
    select batch_data into saved from public.feeding_entry_batches where request_id=p_request for update;
    saved := jsonb_build_object('feeding_time',null) || saved;
    if saved is distinct from payload then raise exception 'This batch was already used. Reload before recording changed entries.'; end if;
    return jsonb_array_length(p_entries);
  end if;
  if p_feeding_time is not null then
    select name into label from public.feeding_times where id=p_feeding_time and not archived;
    if not found then raise exception 'Choose an active feeding time'; end if;
  end if;
  for entry in select * from jsonb_to_recordset(p_entries) as e(horse_id uuid,quantity numeric) order by horse_id loop
    -- Stable IDs make re-submitting the same batch safe; edited retries are rejected.
    perform public.record_stock_movement(md5(p_request::text || entry.horse_id::text)::uuid,
      p_product,p_unit,entry.quantity,'feeding',p_date,null,entry.horse_id,p_notes);
    update public.inventory_movements set feeding_time_id=p_feeding_time,feeding_time_label=label
      where request_id=md5(p_request::text || entry.horse_id::text)::uuid;
    count_saved := count_saved + 1;
  end loop;
  return count_saved;
end; $$;
revoke all on function public.record_bulk_extra_feeding(uuid,uuid,uuid,date,jsonb,text,uuid) from public,anon;
grant execute on function public.record_bulk_extra_feeding(uuid,uuid,uuid,date,jsonb,text,uuid) to authenticated;
