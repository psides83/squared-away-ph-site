begin;
alter table public.horse_video_uploads
 add column abandoned_at timestamptz,
 add column abandoned_by uuid references auth.users(id),
 add column abandoned_reason text,
 add column revision integer not null default 0 check(revision>=0),
 add constraint upload_abandonment_complete check(
  (abandoned_at is null and abandoned_by is null and abandoned_reason is null) or
  (abandoned_at is not null and abandoned_by is not null and abandoned_reason is not null and length(trim(abandoned_reason)) between 1 and 2000 and attached_at is null));
create table public.horse_video_upload_events (
 id uuid primary key, upload_id uuid not null references public.horse_video_uploads(id),
 action text not null check(action in ('abandon','restore')),
 expected_revision integer not null, reason text not null check(length(trim(reason)) between 1 and 2000),
 actor uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index horse_video_upload_events_history on public.horse_video_upload_events(upload_id,created_at desc,id);
alter table public.horse_video_upload_events enable row level security;
revoke all on public.horse_video_upload_events from public,anon,authenticated;
grant select on public.horse_video_upload_events to authenticated;
create policy admin_read on public.horse_video_upload_events for select to authenticated using(public.is_admin());
create function public.change_horse_video_upload(p_request uuid,p_id uuid,p_revision integer,p_action text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u public.horse_video_uploads;e public.horse_video_upload_events;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_id is null or p_revision is null or p_revision<0 or p_action is null or p_action not in ('abandon','restore') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Choose an upload action and enter a reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into e from public.horse_video_upload_events where id=p_request;
 if found then
  if row(e.upload_id,e.expected_revision,e.action,e.reason) is distinct from row(p_id,p_revision,p_action,trim(p_reason)) then raise exception 'This request was already used with different details';end if;
  return e.upload_id;
 end if;
 select * into u from public.horse_video_uploads where id=p_id for update;
 if not found then raise exception 'Video upload not found';end if;
 if u.attached_at is not null or exists(select 1 from public.horse_files where id=p_id) then raise exception 'This video is already saved. Manage it from the file library';end if;
 if u.revision<>p_revision then raise exception 'This upload changed. Refresh before continuing';end if;
 if p_action='abandon' then
  if u.abandoned_at is not null then raise exception 'This upload is already set aside';end if;
  update public.horse_video_uploads set abandoned_at=now(),abandoned_by=auth.uid(),abandoned_reason=trim(p_reason),revision=revision+1 where id=p_id;
 else
  if u.abandoned_at is null then raise exception 'This upload is already pending';end if;
  update public.horse_video_uploads set abandoned_at=null,abandoned_by=null,abandoned_reason=null,revision=revision+1 where id=p_id;
 end if;
 insert into public.horse_video_upload_events(id,upload_id,action,expected_revision,reason,actor) values(p_request,p_id,p_action,p_revision,trim(p_reason),auth.uid());
 return p_id;
end;$$;
revoke all on function public.change_horse_video_upload(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.change_horse_video_upload(uuid,uuid,integer,text,text) to authenticated;

-- Serialize lifecycle changes with all preparation/attachment entry points.
alter function public.prepare_horse_video(uuid,uuid,text,text,text,integer) rename to prepare_horse_video_before_lifecycle;
revoke all on function public.prepare_horse_video_before_lifecycle(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
create function public.prepare_horse_video(p_id uuid,p_horse uuid,p_title text,p_name text,p_type text,p_size integer) returns text
language plpgsql security definer set search_path='' as $$
declare u public.horse_video_uploads;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into u from public.horse_video_uploads where id=p_id for update;
 if found and u.abandoned_at is not null then raise exception 'This upload is set aside. Restore it to pending before continuing';end if;
 return public.prepare_horse_video_before_lifecycle(p_id,p_horse,p_title,p_name,p_type,p_size);
end;$$;
revoke all on function public.prepare_horse_video(uuid,uuid,text,text,text,integer) from public,anon;
grant execute on function public.prepare_horse_video(uuid,uuid,text,text,text,integer) to authenticated;
alter function public.finish_horse_video(uuid) rename to finish_horse_video_before_lifecycle;
revoke all on function public.finish_horse_video_before_lifecycle(uuid) from public,anon,authenticated;
create function public.finish_horse_video(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u public.horse_video_uploads;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into u from public.horse_video_uploads where id=p_id for update;
 if found and u.abandoned_at is not null then raise exception 'This upload is set aside. Restore it to pending before saving';end if;
 return public.finish_horse_video_before_lifecycle(p_id);
end;$$;
revoke all on function public.finish_horse_video(uuid) from public,anon;
grant execute on function public.finish_horse_video(uuid) to authenticated;
create or replace function public.prepare_horse_video_transfer(p_id uuid,p_horse uuid,p_title text,p_name text,p_type text,p_size integer,p_sha256 text) returns text
language plpgsql security definer set search_path='' as $$
declare path text;u public.horse_video_uploads;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Select the original video to verify its contents';end if;
 select * into u from public.horse_video_uploads where id=p_id for update;
 if found and u.abandoned_at is not null then raise exception 'This upload is set aside. Restore it to pending before continuing';end if;
 path:=public.prepare_horse_video(p_id,p_horse,p_title,p_name,p_type,p_size);
 select * into u from public.horse_video_uploads where id=p_id for update;
 if u.sha256 is not null and u.sha256<>p_sha256 then raise exception 'This is a different video. Select the original file or start a new upload';end if;
 if u.sha256 is null then
  if u.attached_at is not null or exists(select 1 from storage.objects where bucket_id='horse-videos' and name=u.object_path) then
   raise exception 'This older upload cannot resume safely. Check its saved file or start a new upload';
  end if;
  update public.horse_video_uploads set sha256=p_sha256 where id=p_id;
 end if;
 return path;
end;$$;
commit;
