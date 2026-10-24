begin;
alter table public.horse_video_uploads add column sha256 text check(sha256 ~ '^[0-9a-f]{64}$');
create function public.prepare_horse_video_transfer(p_id uuid,p_horse uuid,p_title text,p_name text,p_type text,p_size integer,p_sha256 text) returns text
language plpgsql security definer set search_path='' as $$
declare path text;u public.horse_video_uploads;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Select the original video to verify its contents';end if;
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
revoke all on function public.prepare_horse_video_transfer(uuid,uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.prepare_horse_video_transfer(uuid,uuid,text,text,text,integer,text) to authenticated;
commit;
