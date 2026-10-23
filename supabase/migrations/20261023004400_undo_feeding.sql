-- Keep corrected confirmations as history while allowing an intentional new confirmation.
alter table public.feeding_confirmations
 add column cancelled_at timestamptz,
 add column cancelled_by uuid references auth.users(id),
 add column cancellation_reason text;
alter table public.feeding_confirmations drop constraint feeding_confirmations_horse_date_time_key;
create unique index feeding_confirmations_active_slot on public.feeding_confirmations(horse_id,feeding_date,feeding_time_id) nulls not distinct where cancelled_at is null;
create or replace function public.confirm_scheduled_feeding(p_horse uuid,p_date date,p_feeding_time uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare confirmation uuid; r record; result jsonb; label text := 'Daily total (legacy)';
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Confirm an actual feeding date, not a future date'; end if;
  perform id from public.horses where id=p_horse for no key update;
  select id into confirmation from public.feeding_confirmations where cancelled_at is null and horse_id=p_horse and feeding_date=p_date and feeding_time_id is not distinct from p_feeding_time;
  if found then return confirmation; end if;
  if p_feeding_time is not null then
    if exists(select 1 from public.feeding_confirmations where cancelled_at is null and horse_id=p_horse and feeding_date=p_date and feeding_time_id is null) then raise exception 'A full-day feeding was already confirmed for this horse and date. Review its records before adding a timed feeding'; end if;
    if exists(select 1 from public.feed_rations where horse_id=p_horse and active and feeding_time_id is null) then raise exception 'Assign all active daily totals to feeding times before confirming a scheduled feeding'; end if;
    select name into label from public.feeding_times where id=p_feeding_time and not archived;
    if not found then raise exception 'Choose an active feeding time'; end if;
  else
    if exists(select 1 from public.feed_rations where horse_id=p_horse and active and feeding_time_id is not null)
      or exists(select 1 from public.feeding_confirmations where cancelled_at is null and horse_id=p_horse and feeding_date=p_date and feeding_time_id is not null)
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

create function public.undo_feeding_confirmation(p_confirmation uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.feeding_confirmations%rowtype; m record;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 5000 then raise exception 'Enter a correction reason'; end if;
 select * into c from public.feeding_confirmations where id=p_confirmation;
 if not found then raise exception 'Feeding confirmation not found'; end if;
 perform 1 from public.horses where id=c.horse_id for no key update;
 select * into c from public.feeding_confirmations where id=p_confirmation for update;
 if c.cancelled_at is not null then return; end if;
 for m in select id from public.inventory_movements where confirmation_id=c.id and kind='feeding' order by product_id,id loop
   perform public.reverse_stock_consumption(m.id,trim(p_reason));
 end loop;
 update public.feeding_confirmations set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=trim(p_reason) where id=c.id;
end; $$;
revoke all on function public.undo_feeding_confirmation(uuid,text) from public,anon;
grant execute on function public.undo_feeding_confirmation(uuid,text) to authenticated;
