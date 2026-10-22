-- Save the entire setup atomically; stable IDs make retries safe.
create function public.create_feeding_times(p_rows jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r record; saved public.feeding_times;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Provide a list of feeding times'; end if;
  if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Save between 1 and 1000 new times at once'; end if;
  if exists(select 1 from jsonb_to_recordset(p_rows) as x(id uuid,name text,time_of_day text,sort_order integer)
    where id is null or name is null or name<>trim(name) or length(name) not between 1 and 60
      or sort_order is null or sort_order not between 0 and 1000
      or (time_of_day is not null and time_of_day !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')) then
    raise exception 'Check each name, clock time, and display order'; end if;
  if exists(select 1 from jsonb_to_recordset(p_rows) as x(id uuid,name text) group by id having count(*)>1)
    or exists(select 1 from jsonb_to_recordset(p_rows) as x(id uuid,name text) group by lower(name) having count(*)>1) then
    raise exception 'Each feeding time needs a different name'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as x(id uuid,name text,time_of_day text,sort_order integer) order by id loop
    insert into public.feeding_times(id,name,time_of_day,sort_order) values(r.id,r.name,r.time_of_day::time,r.sort_order) on conflict(id) do nothing;
    select * into saved from public.feeding_times where id=r.id for update;
    if saved.name is distinct from r.name or saved.time_of_day is distinct from r.time_of_day::time or saved.sort_order is distinct from r.sort_order or saved.archived then
      raise exception 'A saved feeding time changed. Review it before retrying'; end if;
  end loop;
end; $$;
revoke all on function public.create_feeding_times(jsonb) from public,anon;
grant execute on function public.create_feeding_times(jsonb) to authenticated;
