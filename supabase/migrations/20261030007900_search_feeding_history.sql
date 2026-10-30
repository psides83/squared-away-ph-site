begin;
create index feeding_history_horse_date on public.feeding_confirmations(horse_id,feeding_date desc);
create function public.search_feeding_history(p_from date default null,p_to date default null,p_horse uuid default null,p_query text default null,p_before date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_from is not null and p_to is not null and p_from>p_to then raise exception 'The start date must be on or before the end date';end if;
 if p_horse is not null and not exists(select 1 from public.horses where id=p_horse) then raise exception 'Choose an existing horse';end if;
 if length(coalesce(p_query,''))>100 then raise exception 'Search must be 100 characters or fewer';end if;
 with matches as materialized (
  select c.*,h.barn_name as horse_name from public.feeding_confirmations c join public.horses h on h.id=c.horse_id
  where (p_from is null or c.feeding_date>=p_from) and (p_to is null or c.feeding_date<=p_to)
   and (p_horse is null or c.horse_id=p_horse)
   and (nullif(trim(p_query),'') is null or position(lower(trim(p_query)) in lower(concat_ws(' ',h.barn_name,coalesce(c.feeding_time_label,'Full-day feeding (legacy)'),c.cancellation_reason)))>0)
 ), dates as (
  select distinct feeding_date from matches where p_before is null or feeding_date<p_before order by feeding_date desc limit 7
 ), oldest as (select min(feeding_date) as day from dates)
 select jsonb_build_object('days',coalesce((select jsonb_agg(jsonb_build_object('date',d.feeding_date,'confirmations',(
  select jsonb_agg(jsonb_build_object('id',m.id,'horse_id',m.horse_id,'horse_name',m.horse_name,'feeding_time_id',m.feeding_time_id,'feeding_time_label',m.feeding_time_label,'created_at',m.created_at,'cancelled_at',m.cancelled_at,'cancellation_reason',m.cancellation_reason) order by m.created_at desc,m.id)
  from matches m where m.feeding_date=d.feeding_date)) order by d.feeding_date desc) from dates d),'[]'::jsonb),
 'next_before',case when exists(select 1 from matches where feeding_date<(select day from oldest)) then (select day from oldest) else null end,
 'total_days',(select count(distinct feeding_date) from matches),'total_records',(select count(*) from matches)) into result;
 return result;
end;$$;
revoke all on function public.search_feeding_history(date,date,uuid,text,date) from public,anon;
grant execute on function public.search_feeding_history(date,date,uuid,text,date) to authenticated;
-- Existing callers keep their signature and full-day pagination behavior.
create or replace function public.feeding_confirmation_history(p_before date default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.search_feeding_history(null,null,null,null,p_before);
$$;
revoke all on function public.feeding_confirmation_history(date) from public,anon;
grant execute on function public.feeding_confirmation_history(date) to authenticated;
commit;
