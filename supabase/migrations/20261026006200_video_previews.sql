begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('horse-video-previews','horse-video-previews',false,524288,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table public.horse_video_previews (
 file_id uuid primary key references public.horse_files(id),object_path text not null unique,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),size_bytes integer not null check(size_bytes between 1 and 524288),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table public.horse_video_previews enable row level security;
revoke all on public.horse_video_previews from public,anon,authenticated;
grant select on public.horse_video_previews to authenticated;
create policy admin_read on public.horse_video_previews for select to authenticated using(public.is_admin());
create function public.can_access_video_preview(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.is_admin(),false) or exists(select 1 from public.horse_video_previews p join public.horse_files f on f.id=p.file_id where p.object_path=p_path and f.kind='video' and public.can_access_horse_file(f.object_path));
$$;
revoke all on function public.can_access_video_preview(text) from public,anon;
grant execute on function public.can_access_video_preview(text) to authenticated;
create policy video_previews_read on storage.objects for select to authenticated using(bucket_id='horse-video-previews' and public.can_access_video_preview(name));
create policy video_previews_insert on storage.objects for insert to authenticated with check(bucket_id='horse-video-previews' and public.is_admin() and exists(select 1 from public.horse_files f where f.kind='video' and f.archived_at is null and name ~ ('^'||f.horse_id::text||'/'||f.id::text||'/[0-9a-f]{64}[.]jpg$')));
create policy video_previews_delete on storage.objects for delete to authenticated using(bucket_id='horse-video-previews' and public.is_admin() and not exists(select 1 from public.horse_video_previews p where p.object_path=name));
create function public.attach_video_preview(p_file uuid,p_hash text,p_size integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare f public.horse_files;old public.horse_video_previews;path text;meta jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_file is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_size is null or p_size not between 1 and 524288 then raise exception 'Invalid video preview';end if;
 select * into f from public.horse_files where id=p_file for update;
 if not found or f.kind<>'video' or f.archived_at is not null then raise exception 'Choose an active saved video';end if;
 select * into old from public.horse_video_previews where file_id=p_file;
 if found then
  if row(old.sha256,old.size_bytes) is distinct from row(p_hash,p_size) then raise exception 'A preview is already saved for this video';end if;
  return p_file;
 end if;
 path:=f.horse_id::text||'/'||f.id::text||'/'||p_hash||'.jpg';
 select metadata into meta from storage.objects where bucket_id='horse-video-previews' and name=path;
 if not found or meta is null or (meta->>'size')::bigint is distinct from p_size::bigint or meta->>'mimetype' is distinct from 'image/jpeg' then raise exception 'Complete the matching JPEG preview upload first';end if;
 insert into public.horse_video_previews(file_id,object_path,sha256,size_bytes,created_by) values(p_file,path,p_hash,p_size,auth.uid());
 insert into public.portal_admin_events(id,kind,horse_id,file_id,reason,snapshot,actor) values(gen_random_uuid(),'video_preview_attached',f.horse_id,f.id,'Generated video preview saved',jsonb_build_object('path',path,'sha256',p_hash,'size_bytes',p_size),auth.uid());
 return p_file;
end;$$;
create function public.portal_video_preview(p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
 if public.current_customer_id() is null then raise exception 'Customer portal access required';end if;
 select p.object_path into path from public.horse_video_previews p join public.horse_files f on f.id=p.file_id where p.file_id=p_id and f.kind='video' and public.can_access_horse_file(f.object_path);
 return path;
end;$$;
revoke all on function public.attach_video_preview(uuid,text,integer),public.portal_video_preview(uuid) from public,anon;
grant execute on function public.attach_video_preview(uuid,text,integer),public.portal_video_preview(uuid) to authenticated;
create or replace function public.portal_files(p_horse uuid default null,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid file page'; end if;
  with matches as (
    select f.id,f.horse_id,h.barn_name as horse_name,f.kind,f.title,f.file_name,f.content_type,f.size_bytes,f.published_at,exists(select 1 from public.horse_video_previews p where p.file_id=f.id) as has_preview from public.horse_files f join public.horses h on h.id=f.horse_id
    join public.customer_horse_access a on a.horse_id=f.horse_id and a.customer_id=customer and a.active
    where f.published_at is not null and f.archived_at is null and (p_horse is null or f.horse_id=p_horse)
    and (a.visible_from is null or (f.published_at at time zone 'America/Chicago')::date>=a.visible_from)
  ), page as(select * from matches order by published_at desc,id limit 24 offset (p_page-1)*24)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by published_at desc,id) from page),'[]'),'total',(select count(*) from matches)) into result;return result;
end $$;
commit;
