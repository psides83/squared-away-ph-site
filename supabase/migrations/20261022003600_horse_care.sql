begin;
create table public.horse_care_records (
 id uuid primary key,horse_id uuid not null references public.horses(id),care_date date not null,
 kind text not null check(kind in ('farrier','veterinary','vaccination','deworming','dental','other')),
 title text not null check(length(trim(title)) between 1 and 200),provider text check(length(provider)<=200),
 notes text not null check(length(notes) between 1 and 5000),private_notes text check(length(private_notes)<=5000),
 published_at timestamptz,archived_at timestamptz,revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid not null references auth.users(id)
);
create index care_horse_date on public.horse_care_records(horse_id,care_date desc,id);
create table public.horse_care_events (
 id uuid primary key,record_id uuid not null references public.horse_care_records(id),operation text not null,
 reason text not null,payload jsonb not null,previous jsonb,created_at timestamptz not null default now(),actor uuid not null references auth.users(id)
);
alter table public.horse_care_records enable row level security;
alter table public.horse_care_events enable row level security;
revoke all on public.horse_care_records,public.horse_care_events from public,anon,authenticated;
grant select on public.horse_care_records,public.horse_care_events to authenticated;
create policy admin_read on public.horse_care_records for select to authenticated using(public.is_admin());
create policy admin_read on public.horse_care_events for select to authenticated using(public.is_admin());
create function public.save_horse_care(p_request uuid,p_id uuid,p_revision integer,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.horse_care_records;prior public.horse_care_records;event public.horse_care_events;record_id uuid:=coalesce(p_id,p_request);
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null then raise exception 'Reload before saving care';end if;
 select * into event from public.horse_care_events where id=p_request;
 if found then
  if event.operation<>'save' or event.record_id<>record_id or event.payload is distinct from p_data then raise exception 'This care form was already used. Reload before saving another change';end if;
  return event.record_id;
 end if;
 v:=jsonb_populate_record(null::public.horse_care_records,p_data);
 if v.care_date is null or v.care_date>(now() at time zone 'America/Chicago')::date then raise exception 'Record the actual care date; use Reminders for future care';end if;
 if p_id is null then
  if p_revision is distinct from 0 then raise exception 'Reload before adding care';end if;
  insert into public.horse_care_records(id,horse_id,care_date,kind,title,provider,notes,private_notes,created_by)
  values(record_id,v.horse_id,v.care_date,v.kind,trim(v.title),nullif(trim(v.provider),''),trim(v.notes),nullif(trim(v.private_notes),''),auth.uid());
 else
  select * into prior from public.horse_care_records where id=p_id for update;
  if not found or prior.revision is distinct from p_revision then raise exception 'This care record changed. Reload before editing';end if;
  if prior.published_at is not null or prior.archived_at is not null then raise exception 'Unshare or restore this care record before editing';end if;
  if v.horse_id is distinct from prior.horse_id then raise exception 'Care records remain with their original horse';end if;
  update public.horse_care_records set care_date=v.care_date,kind=v.kind,title=trim(v.title),provider=nullif(trim(v.provider),''),notes=trim(v.notes),private_notes=nullif(trim(v.private_notes),''),revision=revision+1,updated_at=now() where id=p_id;
 end if;
 insert into public.horse_care_events(id,record_id,operation,reason,payload,previous,actor) values(p_request,record_id,'save','Care record saved',p_data,to_jsonb(prior),auth.uid());
 return record_id;
end;$$;
create function public.change_horse_care(p_request uuid,p_id uuid,p_revision integer,p_action text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.horse_care_records;event public.horse_care_events;data jsonb:=jsonb_build_object('action',p_action,'reason',trim(p_reason));
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_action is null or p_action not in ('share','unshare','archive','restore') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Choose a care action and enter a reason';end if;
 select * into event from public.horse_care_events where id=p_request;
 if found then
  if event.operation<>'status' or event.record_id<>p_id or event.payload is distinct from data then raise exception 'This care action was already used. Reload before continuing';end if;return;
 end if;
 select * into prior from public.horse_care_records where id=p_id for update;
 if not found or prior.revision is distinct from p_revision then raise exception 'This care record changed. Reload before continuing';end if;
 if prior.archived_at is not null and p_action<>'restore' then raise exception 'Restore this care record first';end if;
 if p_action='restore' and prior.archived_at is null then raise exception 'This care record is not archived';end if;
 if p_action='share' and prior.published_at is not null then raise exception 'This care record is already shared';end if;
 if p_action='unshare' and prior.published_at is null then raise exception 'This care record is already private';end if;
 update public.horse_care_records set
 published_at=case p_action when 'share' then coalesce(published_at,now()) when 'unshare' then null when 'archive' then null else published_at end,
 archived_at=case p_action when 'archive' then now() when 'restore' then null else archived_at end,
 revision=revision+1,updated_at=now() where id=p_id;
 insert into public.horse_care_events(id,record_id,operation,reason,payload,previous,actor) values(p_request,p_id,'status',trim(p_reason),data,to_jsonb(prior),auth.uid());
end;$$;
create function public.portal_care_records(p_horse uuid default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
 if customer is null then raise exception 'Customer portal access required';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid care page';end if;
 with matches as (
 select r.id,r.horse_id,h.barn_name as horse_name,r.care_date,r.kind,r.title,r.provider,r.notes,r.published_at
 from public.horse_care_records r join public.horses h on h.id=r.horse_id join public.customer_horse_access a on a.horse_id=r.horse_id
 where a.customer_id=customer and a.active and r.published_at is not null and r.archived_at is null
 and (p_horse is null or r.horse_id=p_horse)
 and (a.visible_from is null or (r.published_at at time zone 'America/Chicago')::date>=a.visible_from)
 ), page as (select * from matches order by care_date desc,id limit 25 offset (p_page-1)*25)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by care_date desc,id) from page),'[]'),'total',(select count(*) from matches)) into result;
 return result;
end;$$;
revoke all on function public.save_horse_care(uuid,uuid,integer,jsonb),public.change_horse_care(uuid,uuid,integer,text,text),public.portal_care_records(uuid,integer) from public,anon;
grant execute on function public.save_horse_care(uuid,uuid,integer,jsonb),public.change_horse_care(uuid,uuid,integer,text,text),public.portal_care_records(uuid,integer) to authenticated;
commit;
