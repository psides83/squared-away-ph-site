begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('horse-videos','horse-videos',false,52428800,array['video/mp4','video/quicktime','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
alter table public.horse_files drop constraint horse_files_kind_check;
alter table public.horse_files drop constraint horse_files_content_type_check;
alter table public.horse_files drop constraint horse_files_size_bytes_check;
alter table public.horse_files add constraint horse_files_media_valid check(
 (kind in ('photo','document') and content_type in ('image/jpeg','image/png','image/webp','application/pdf') and size_bytes between 1 and 3145728)
 or (kind='video' and content_type in ('video/mp4','video/quicktime','video/webm') and size_bytes between 1 and 52428800));
create table public.horse_video_uploads (
 id uuid primary key,horse_id uuid not null references public.horses(id),title text not null check(length(trim(title)) between 1 and 200),
 file_name text not null check(length(file_name) between 1 and 200),content_type text not null check(content_type in ('video/mp4','video/quicktime','video/webm')),
 size_bytes integer not null check(size_bytes between 1 and 52428800),object_path text not null unique,created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),attached_at timestamptz
);
alter table public.horse_video_uploads enable row level security;
revoke all on public.horse_video_uploads from public,anon,authenticated;
grant select on public.horse_video_uploads to authenticated;
create policy admin_read on public.horse_video_uploads for select to authenticated using(public.is_admin());
create policy videos_insert on storage.objects for insert to authenticated with check(bucket_id='horse-videos' and public.is_admin());
create policy videos_delete on storage.objects for delete to authenticated using(bucket_id='horse-videos' and public.is_admin());
create function public.can_access_horse_video(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.horse_files f where f.object_path=p_path and f.kind='video' and public.can_access_horse_file(p_path));
$$;
revoke all on function public.can_access_horse_video(text) from public,anon;
grant execute on function public.can_access_horse_video(text) to authenticated;
create policy videos_read on storage.objects for select to authenticated using(bucket_id='horse-videos' and public.can_access_horse_video(name));
create function public.prepare_horse_video(p_id uuid,p_horse uuid,p_title text,p_name text,p_type text,p_size integer) returns text
language plpgsql security definer set search_path='' as $$
declare old public.horse_video_uploads;path text;extension text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_id is null or p_horse is null or p_title is null or length(trim(p_title)) not between 1 and 200 or p_name is null or length(p_name) not between 1 and 200 or p_size is null or p_size not between 1 and 52428800 then raise exception 'Enter a title and a video up to 50 MB';end if;
 extension:=case p_type when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' else null end;
 if extension is null then raise exception 'Choose an MP4, MOV, or WebM video';end if;
 path:=p_horse::text||'/'||p_id::text||'.'||extension;
 select * into old from public.horse_video_uploads where id=p_id;
 if found then
  if row(old.horse_id,old.title,old.file_name,old.content_type,old.size_bytes) is distinct from row(p_horse,trim(p_title),p_name,p_type,p_size) then raise exception 'This video upload was already prepared with different details';end if;
  return old.object_path;
 end if;
 insert into public.horse_video_uploads(id,horse_id,title,file_name,content_type,size_bytes,object_path,created_by) values(p_id,p_horse,trim(p_title),p_name,p_type,p_size,path,auth.uid());return path;
end;$$;
create function public.finish_horse_video(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u public.horse_video_uploads;meta jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into u from public.horse_video_uploads where id=p_id for update;
 if not found then raise exception 'Video upload not found';end if;
 if u.attached_at is not null then return u.id;end if;
 select metadata into meta from storage.objects where bucket_id='horse-videos' and name=u.object_path;
 if not found or meta is null then raise exception 'Complete the video upload before attaching it';end if;
 if (meta->>'size')::bigint is distinct from u.size_bytes::bigint or meta->>'mimetype' is distinct from u.content_type then raise exception 'Uploaded video size or type does not match the prepared file';end if;
 insert into public.horse_files(id,horse_id,kind,title,file_name,object_path,content_type,size_bytes) values(u.id,u.horse_id,'video',u.title,u.file_name,u.object_path,u.content_type,u.size_bytes);
 insert into public.portal_admin_events(id,kind,horse_id,file_id,reason,snapshot,actor) values(gen_random_uuid(),'file_attached',u.horse_id,u.id,'Private video uploaded',jsonb_build_object('title',u.title,'path',u.object_path),auth.uid());
 update public.horse_video_uploads set attached_at=now() where id=u.id;return u.id;
end;$$;
create or replace function public.portal_file(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
 if customer is null then raise exception 'Customer portal access required';end if;
 select jsonb_build_object('path',f.object_path,'name',f.file_name,'type',f.content_type,'kind',f.kind) into result from public.horse_files f where f.id=p_id and public.can_access_horse_file(f.object_path);return result;
end;$$;
revoke all on function public.prepare_horse_video(uuid,uuid,text,text,text,integer),public.finish_horse_video(uuid) from public,anon;
grant execute on function public.prepare_horse_video(uuid,uuid,text,text,text,integer),public.finish_horse_video(uuid) to authenticated;
commit;
