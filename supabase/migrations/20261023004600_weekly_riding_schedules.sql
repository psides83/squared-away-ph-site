-- Recurring plans are deliberately separate from actual sessions and billing days.
create table public.horse_riding_schedules (
 horse_id uuid primary key references public.horses(id) on delete restrict,
 days jsonb check(days is null or (jsonb_typeof(days)='array' and jsonb_array_length(days)=7 and days <@ '["training","off"]'::jsonb)),
 notes text check(length(notes)<=2000),
 version uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now(),
 updated_by uuid not null default auth.uid() references auth.users(id)
);
alter table public.horse_riding_schedules enable row level security;
revoke all on public.horse_riding_schedules from anon,authenticated;
grant select on public.horse_riding_schedules to authenticated;
create policy admin_only on public.horse_riding_schedules for select to authenticated using ((select public.is_admin()));
create function public.save_horse_riding_schedule(p_horse uuid,p_expected uuid,p_days jsonb,p_notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior uuid; result uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 perform 1 from public.horses where id=p_horse for no key update;
 if not found then raise exception 'Horse not found'; end if;
 if p_days is not null then
  if jsonb_typeof(p_days)<>'array' then raise exception 'Choose training or off for all seven days'; end if;
  if jsonb_array_length(p_days)<>7 or not (p_days <@ '["training","off"]'::jsonb) then raise exception 'Choose training or off for all seven days'; end if;
 end if;
 if length(p_notes)>2000 then raise exception 'Keep riding notes within 2000 characters'; end if;
 select version into prior from public.horse_riding_schedules where horse_id=p_horse;
 if prior is distinct from p_expected then raise exception 'This riding plan changed since you opened it. Close and reopen the editor before saving'; end if;
 insert into public.horse_riding_schedules(horse_id,days,notes) values(p_horse,p_days,case when p_days is null then null else nullif(trim(p_notes),'') end)
 on conflict(horse_id) do update set days=excluded.days,notes=excluded.notes,version=gen_random_uuid(),updated_at=now(),updated_by=auth.uid()
 returning version into result;
 return result;
end; $$;
revoke all on function public.save_horse_riding_schedule(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.save_horse_riding_schedule(uuid,uuid,jsonb,text) to authenticated;
