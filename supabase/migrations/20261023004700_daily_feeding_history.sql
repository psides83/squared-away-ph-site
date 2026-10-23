-- Page by complete recorded days rather than cutting off a day's confirmations.
create function public.feeding_confirmation_history(p_before date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare dates date[]; result jsonb; oldest date;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select array_agg(feeding_date order by feeding_date desc) into dates from (
  select distinct feeding_date from public.feeding_confirmations where p_before is null or feeding_date<p_before order by feeding_date desc limit 7
 ) d;
 select min(d) into oldest from unnest(dates) d;
 select coalesce(jsonb_agg(jsonb_build_object('date',d,'confirmations',(
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'horse_id',c.horse_id,'horse_name',h.barn_name,'feeding_time_id',c.feeding_time_id,'feeding_time_label',c.feeding_time_label,'created_at',c.created_at,'cancelled_at',c.cancelled_at,'cancellation_reason',c.cancellation_reason) order by c.created_at desc,c.id),'[]'::jsonb)
  from public.feeding_confirmations c join public.horses h on h.id=c.horse_id where c.feeding_date=d
 )) order by d desc),'[]'::jsonb) into result from unnest(dates) d;
 return jsonb_build_object('days',result,'next_before',case when exists(select 1 from public.feeding_confirmations where feeding_date<oldest) then oldest else null end);
end; $$;
revoke all on function public.feeding_confirmation_history(date) from public,anon;
grant execute on function public.feeding_confirmation_history(date) to authenticated;
