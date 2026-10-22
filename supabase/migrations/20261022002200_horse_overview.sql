-- Horse-level billing uses explicit stay/reporting assignments, never current ownership.
create function public.horse_overview() returns table(
 horse_id uuid,last_trained date,training_title text,last_fed date,feeding_label text,
 outstanding_cents bigint,overdue_cents bigint,bills jsonb
) language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 return query select h.id,t.entry_date,t.title,f.movement_date,f.feeding_time_label,
   coalesce(b.outstanding,0)::bigint,coalesce(b.overdue,0)::bigint,coalesce(b.bills,'[]'::jsonb)
 from public.horses h
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

 left join lateral (
   select sum(i.balance_cents) outstanding,
     sum(i.balance_cents) filter(where i.due_date < (now() at time zone 'America/Chicago')::date) overdue,
     jsonb_agg(jsonb_build_object('id',i.id,'number',i.invoice_number,'due_date',i.due_date,'balance_cents',i.balance_cents)
       order by i.due_date,i.id) bills
   from public.invoice_totals i
   left join public.training_stays s on s.id=i.stay_id
   left join public.invoice_reporting_links r on r.invoice_id=i.id and r.retired_at is null
   where i.status='issued' and i.balance_cents>0 and coalesce(s.horse_id,r.horse_id)=h.id
 ) b on true
 order by h.barn_name,h.id;
end; $$;
revoke all on function public.horse_overview() from public,anon;
grant execute on function public.horse_overview() to authenticated;
