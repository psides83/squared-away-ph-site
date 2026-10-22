-- Read latest activity per horse without truncating a shared activity feed.
create function public.training_worklist() returns table(
  horse_id uuid,barn_name text,arrival_date date,last_trained date,training_title text,
  last_fed date,feeding_label text
) language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  return query
    select h.id,h.barn_name,s.arrival_date,t.entry_date,t.title,f.movement_date,f.feeding_time_label
    from public.horses h
    join public.training_stays s on s.horse_id=h.id
      and s.arrival_date <= (now() at time zone 'America/Chicago')::date
      and (s.departure_date is null or s.departure_date >= (now() at time zone 'America/Chicago')::date)
    left join lateral (
      select e.entry_date,e.title from public.training_entries e
      where e.horse_id=h.id and e.kind='session'
        and e.entry_date <= (now() at time zone 'America/Chicago')::date
      order by e.entry_date desc,e.created_at desc,e.id limit 1
    ) t on true
    left join lateral (
      select m.movement_date,m.feeding_time_label from public.inventory_movements m
      where m.horse_id=h.id and m.kind='feeding'
        and m.movement_date <= (now() at time zone 'America/Chicago')::date
        and not exists(select 1 from public.inventory_movements r where r.reverses_id=m.id)
      order by m.movement_date desc,m.created_at desc,m.id limit 1
    ) f on true
    order by h.barn_name,h.id;
end; $$;
revoke all on function public.training_worklist() from public,anon;
grant execute on function public.training_worklist() to authenticated;
