begin;

-- Recorded customer-link changes, not inferred legal sale or effective dates.
create table public.horse_ownership_events (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete restrict,
  customer_id uuid not null,
  customer_name text not null,
  event text not null check (event in ('baseline','added','removed','relationship_changed')),
  previous_relationship text,
  relationship text,
  recorded_at timestamptz not null default clock_timestamp(),
  actor_id uuid
);
create index horse_ownership_events_horse_idx on public.horse_ownership_events(horse_id,recorded_at desc,id);
alter table public.horse_ownership_events enable row level security;
revoke all on public.horse_ownership_events from anon,authenticated;
grant select on public.horse_ownership_events to authenticated;
create policy ownership_events_admin_read on public.horse_ownership_events for select to authenticated using ((select public.is_admin()));

-- Baselines explicitly say only what is linked when tracking begins. Snapshot
-- names survive customer renames/deletion; no past transfer dates are invented.
insert into public.horse_ownership_events(horse_id,customer_id,customer_name,event,relationship)
select hc.horse_id,hc.customer_id,c.name,'baseline',hc.relationship
from public.horse_customers hc join public.customers c on c.id=hc.customer_id;

create function public.record_horse_ownership_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'UPDATE' and row(old.horse_id,old.customer_id,old.relationship) is not distinct from row(new.horse_id,new.customer_id,new.relationship) then
    return new;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and row(old.horse_id,old.customer_id) is distinct from row(new.horse_id,new.customer_id)) then
    insert into public.horse_ownership_events(horse_id,customer_id,customer_name,event,previous_relationship,actor_id)
      select old.horse_id,old.customer_id,c.name,'removed',old.relationship,auth.uid() from public.customers c where c.id=old.customer_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and row(old.horse_id,old.customer_id) is distinct from row(new.horse_id,new.customer_id)) then
    insert into public.horse_ownership_events(horse_id,customer_id,customer_name,event,relationship,actor_id)
      select new.horse_id,new.customer_id,c.name,'added',new.relationship,auth.uid() from public.customers c where c.id=new.customer_id;
  elsif tg_op = 'UPDATE' then
    insert into public.horse_ownership_events(horse_id,customer_id,customer_name,event,previous_relationship,relationship,actor_id)
      select new.horse_id,new.customer_id,c.name,'relationship_changed',old.relationship,new.relationship,auth.uid() from public.customers c where c.id=new.customer_id;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.record_horse_ownership_event() from public,anon,authenticated;
create trigger horse_ownership_history after insert or update or delete on public.horse_customers
for each row execute function public.record_horse_ownership_event();

commit;
