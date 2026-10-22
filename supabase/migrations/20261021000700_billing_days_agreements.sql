begin;

alter table public.training_stays
  add column feed_billing text not null default 'unrecorded' check (feed_billing in ('unrecorded','included','separate_monthly','at_cost','not_provided')),
  add column feed_monthly_cents integer check (feed_monthly_cents between 0 and 100000000),
  add column boarding_billing text not null default 'unrecorded' check (boarding_billing in ('unrecorded','included','separate_monthly','at_cost','not_provided')),
  add column boarding_monthly_cents integer check (boarding_monthly_cents between 0 and 100000000),
  add constraint feed_rate_matches_mode check ((feed_billing='separate_monthly' and feed_monthly_cents is not null) or (feed_billing<>'separate_monthly' and feed_monthly_cents is null)),
  add constraint boarding_rate_matches_mode check ((boarding_billing='separate_monthly' and boarding_monthly_cents is not null) or (boarding_billing<>'separate_monthly' and boarding_monthly_cents is null));

create table public.training_days (
  stay_id uuid not null references public.training_stays(id) on delete restrict,
  day date not null, status text not null check (status in ('worked','rest','nonbillable')),
  notes text check (length(notes)<=5000), updated_at timestamptz not null default now(), primary key(stay_id,day)
);
create table public.training_day_events (
  id uuid primary key default gen_random_uuid(), stay_id uuid not null references public.training_stays(id) on delete restrict,
  day date not null, previous_status text, new_status text, notes text,
  changed_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index training_day_events_stay_idx on public.training_day_events(stay_id,created_at desc);
alter table public.training_days enable row level security;
alter table public.training_day_events enable row level security;
revoke all on public.training_days,public.training_day_events from anon,authenticated;
grant select on public.training_days,public.training_day_events to authenticated;
create policy admin_read on public.training_days for select to authenticated using ((select public.is_admin()));
create policy admin_read on public.training_day_events for select to authenticated using ((select public.is_admin()));

create function public.set_training_days(p_stay uuid,p_from date,p_to date,p_status text,p_notes text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare stay public.training_stays%rowtype; d date; old_status text; old_notes text; new_status text; changes integer:=0;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>365 then raise exception 'Choose a valid range of at most 366 days'; end if;
  if p_status is null or p_status not in ('worked','rest','nonbillable','clear') then raise exception 'Choose a valid day status'; end if;
  if length(p_notes)>5000 then raise exception 'Notes are too long'; end if;
  if p_to>(now() at time zone 'America/Chicago')::date then raise exception 'Classify actual days, not future work or rest'; end if;
  select * into stay from public.training_stays where id=p_stay for update;
  if not found then raise exception 'Training stay not found'; end if;
  if p_from<stay.arrival_date or (stay.departure_date is not null and p_to>stay.departure_date) then raise exception 'Dates must fall within the physical training stay'; end if;
  new_status:=case when p_status='clear' then null else p_status end;
  d:=p_from;
  while d<=p_to loop
    old_status:=null;old_notes:=null;
    select status,notes into old_status,old_notes from public.training_days where stay_id=p_stay and day=d;
    if old_status is distinct from new_status or (new_status is not null and old_notes is distinct from p_notes) then
      if new_status is null then
        delete from public.training_days where stay_id=p_stay and day=d;
      else
        insert into public.training_days(stay_id,day,status,notes) values(p_stay,d,new_status,p_notes)
          on conflict(stay_id,day) do update set status=excluded.status,notes=excluded.notes,updated_at=now();
      end if;
      insert into public.training_day_events(stay_id,day,previous_status,new_status,notes,changed_by)
        values(p_stay,d,old_status,new_status,p_notes,auth.uid());
      changes:=changes+1;
    end if;
    d:=d+1;
  end loop;
  return changes;
end; $$;
revoke all on function public.set_training_days(uuid,date,date,text,text) from public;
grant execute on function public.set_training_days(uuid,date,date,text,text) to authenticated;

create function public.guard_training_day_history() returns trigger language plpgsql set search_path='' as $$ begin
  if new.horse_id<>old.horse_id and exists(select 1 from public.training_day_events where stay_id=old.id) then
    raise exception 'This stay has billing-day history. Create a new stay rather than reassigning its horse.';
  end if;
  if exists(select 1 from public.training_days where stay_id=old.id and (day<new.arrival_date or (new.departure_date is not null and day>new.departure_date))) then
    raise exception 'Recorded billing days fall outside the proposed stay dates. Review and clear incorrect days first.';
  end if;
  return new;
end; $$;
revoke all on function public.guard_training_day_history() from public;
create trigger protect_training_days before update of horse_id,arrival_date,departure_date on public.training_stays
  for each row execute function public.guard_training_day_history();

commit;
