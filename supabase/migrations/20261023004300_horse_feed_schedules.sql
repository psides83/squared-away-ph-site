begin;
create table public.horse_feed_schedule_edits (
 id uuid primary key,horse_id uuid not null references public.horses(id),source_time uuid references public.feeding_times(id),target_time uuid references public.feeding_times(id),
 before_rows jsonb not null,after_rows jsonb not null,created_at timestamptz not null default now(),created_by uuid not null references auth.users(id)
);
alter table public.horse_feed_schedule_edits enable row level security;
revoke all on public.horse_feed_schedule_edits from public,anon,authenticated;
grant select on public.horse_feed_schedule_edits to authenticated;
create policy admin_read on public.horse_feed_schedule_edits for select to authenticated using(public.is_admin());
-- Serialize schedule writes with feeding confirmation, including older admin clients.
create function public.lock_horse_feed_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare horse_ids uuid[];
begin
 if tg_op='INSERT' then horse_ids:=array[new.horse_id];elsif tg_op='DELETE' then horse_ids:=array[old.horse_id];else horse_ids:=array[old.horse_id,new.horse_id];end if;
 perform id from public.horses where id=any(horse_ids) order by id for no key update;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create trigger serialize_feed_schedule before insert or update or delete on public.feed_rations for each row execute function public.lock_horse_feed_schedule();
create function public.save_horse_feed_schedule(p_request uuid,p_horse uuid,p_source_time uuid,p_target_time uuid,p_expected jsonb,p_rows jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare before_data jsonb;expected_data jsonb;after_data jsonb;previous public.horse_feed_schedule_edits;r record;target public.feeding_times;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_horse is null or p_expected is null or jsonb_typeof(p_expected)<>'array' or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Reload the feeding schedule before saving';end if;
 if jsonb_array_length(p_expected)>100 or jsonb_array_length(p_rows)>100 then raise exception 'A feeding time supports up to 100 rations';end if;
 perform id from public.horses where id=p_horse for no key update;
 if not found then raise exception 'Horse not found';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',(e->>'id')::uuid,'product_id',(e->>'product_id')::uuid,'unit_id',(e->>'unit_id')::uuid,'quantity',(e->>'quantity')::numeric,'active',(e->>'active')::boolean,'notes',nullif(trim(e->>'notes'),'')) order by (e->>'id')::uuid),'[]') into expected_data from jsonb_array_elements(p_expected) e;
 if exists(select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e)<>'object' or e->>'id' is null or e->>'product_id' is null or e->>'unit_id' is null or e->>'quantity' is null or jsonb_typeof(e->'active') is distinct from 'boolean') then raise exception 'Complete every ration before saving this feeding time';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',(e->>'id')::uuid,'product_id',(e->>'product_id')::uuid,'unit_id',(e->>'unit_id')::uuid,'quantity',(e->>'quantity')::numeric,'active',(e->>'active')::boolean,'notes',nullif(trim(e->>'notes'),'')) order by (e->>'id')::uuid),'[]') into after_data from jsonb_array_elements(p_rows) e;
 select * into previous from public.horse_feed_schedule_edits where id=p_request;
 if found then
  if row(previous.horse_id,previous.source_time,previous.target_time,previous.before_rows,previous.after_rows) is distinct from row(p_horse,p_source_time,p_target_time,expected_data,after_data) then raise exception 'This schedule form was already used. Reload';end if;
  return previous.id;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'unit_id',unit_id,'quantity',quantity,'active',active,'notes',nullif(trim(notes),'')) order by id),'[]') into before_data from public.feed_rations where horse_id=p_horse and feeding_time_id is not distinct from p_source_time;
 if before_data<>expected_data then raise exception 'This feeding time changed while you were editing. Close and reload the horse record before saving';end if;
 if p_target_time is distinct from p_source_time and exists(select 1 from public.feed_rations where horse_id=p_horse and feeding_time_id is not distinct from p_target_time) then raise exception 'That feeding time already has a schedule. Edit it separately or choose an empty feeding time';end if;
 if jsonb_array_length(after_data)>0 then
  select * into target from public.feeding_times where id=p_target_time for share;
  if not found then raise exception 'Choose a feeding time';end if;
  if target.archived and (p_source_time is distinct from p_target_time or exists(select 1 from jsonb_array_elements(after_data) e where (e->>'active')::boolean)) then raise exception 'Choose an active feeding time or keep this archived schedule paused';end if;
 end if;
 if (select count(*)<>count(distinct e->>'id') or count(*)<>count(distinct e->>'product_id') from jsonb_array_elements(after_data) e) then raise exception 'Use one ration per product in this feeding time';end if;
 for r in select * from jsonb_to_recordset(after_data) as x(id uuid,product_id uuid,unit_id uuid,quantity numeric,active boolean,notes text) loop
  if r.quantity<=0 or r.quantity>1000000000 or r.quantity<>round(r.quantity,6) or coalesce(length(r.notes),0)>2000 then raise exception 'Enter positive quantities with up to six decimals and notes up to 2,000 characters';end if;
  if exists(select 1 from public.feed_rations where id=r.id and (horse_id<>p_horse or feeding_time_id is distinct from p_source_time)) then raise exception 'A ration belongs to another horse or feeding time. Reload';end if;
  if not exists(select 1 from public.inventory_units where id=r.unit_id and product_id=r.product_id) then raise exception 'Choose a unit belonging to each ration product';end if;
  if not exists(select 1 from public.inventory_products where id=r.product_id and (not archived or (not r.active and exists(select 1 from public.feed_rations where id=r.id and product_id=r.product_id and horse_id=p_horse)))) then raise exception 'Choose active products, or keep existing archived products paused';end if;
 end loop;
 delete from public.feed_rations where horse_id=p_horse and feeding_time_id is not distinct from p_source_time;
 insert into public.feed_rations(id,horse_id,feeding_time_id,product_id,unit_id,quantity,active,notes)
 select id,p_horse,p_target_time,product_id,unit_id,quantity,active,notes from jsonb_to_recordset(after_data) as x(id uuid,product_id uuid,unit_id uuid,quantity numeric,active boolean,notes text);
 insert into public.horse_feed_schedule_edits(id,horse_id,source_time,target_time,before_rows,after_rows,created_by)
 values(p_request,p_horse,p_source_time,p_target_time,before_data,after_data,auth.uid());
 return p_request;
end;$$;
revoke all on function public.save_horse_feed_schedule(uuid,uuid,uuid,uuid,jsonb,jsonb),public.lock_horse_feed_schedule() from public,anon;
grant execute on function public.save_horse_feed_schedule(uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;
commit;
