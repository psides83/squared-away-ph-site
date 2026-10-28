begin;
create table public.video_preview_changes (
 id uuid primary key,file_id uuid not null references public.horse_files(id),
 previous_hash text not null check(previous_hash ~ '^[0-9a-f]{64}$'),previous_path text not null,previous_size integer not null check(previous_size between 1 and 524288),
 previous_created_at timestamptz not null,previous_created_by uuid not null references auth.users(id),
 next_hash text not null check(next_hash ~ '^[0-9a-f]{64}$'),next_path text not null,next_size integer not null check(next_size between 1 and 524288),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id)
);
create index video_preview_changes_file on public.video_preview_changes(file_id,created_at desc,id);
alter table public.video_preview_changes enable row level security;
revoke all on public.video_preview_changes from public,anon,authenticated;
grant select on public.video_preview_changes to authenticated;
create policy admin_read on public.video_preview_changes for select to authenticated using((select public.is_admin()));
drop policy video_previews_delete on storage.objects;
create policy video_previews_delete on storage.objects for delete to authenticated using(bucket_id='horse-video-previews' and public.is_admin()
 and not exists(select 1 from public.horse_video_previews p where p.object_path=name)
 and not exists(select 1 from public.video_preview_changes c where c.previous_path=name or c.next_path=name));
create function public.replace_video_preview(p_request uuid,p_file uuid,p_expected text,p_hash text,p_size integer) returns uuid language plpgsql security definer set search_path='' as $$
declare f public.horse_files;current_preview public.horse_video_previews;prior public.video_preview_changes;path text;meta jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_file is null or p_expected is null or p_expected !~ '^[0-9a-f]{64}$' or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_size is null or p_size not between 1 and 524288 then raise exception 'Invalid replacement video preview';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.video_preview_changes where id=p_request;
 if found then
 if row(prior.file_id,prior.previous_hash,prior.next_hash,prior.next_size) is distinct from row(p_file,p_expected,p_hash,p_size) then raise exception 'This preview request was already saved. Reopen the editor for another change';end if;
 return prior.id;end if;
 select * into f from public.horse_files where id=p_file for update;
 if not found or f.kind<>'video' or f.archived_at is not null then raise exception 'Choose an active saved video';end if;
 select * into current_preview from public.horse_video_previews where file_id=p_file for update;
 if not found or current_preview.sha256<>p_expected then raise exception 'The saved preview changed. Reopen the editor and review the current preview before replacing it';end if;
 if p_hash=current_preview.sha256 then raise exception 'This frame matches the saved preview. Choose another frame time';end if;
 path:=f.horse_id::text||'/'||f.id::text||'/'||p_hash||'.jpg';
 select metadata into meta from storage.objects where bucket_id='horse-video-previews' and name=path;
 if not found or meta is null or (meta->>'size')::bigint is distinct from p_size::bigint or meta->>'mimetype' is distinct from 'image/jpeg' then raise exception 'Complete the matching JPEG preview upload first';end if;
 insert into public.video_preview_changes(id,file_id,previous_hash,previous_path,previous_size,previous_created_at,previous_created_by,next_hash,next_path,next_size,created_by)
 values(p_request,p_file,current_preview.sha256,current_preview.object_path,current_preview.size_bytes,current_preview.created_at,current_preview.created_by,p_hash,path,p_size,auth.uid());
 update public.horse_video_previews set object_path=path,sha256=p_hash,size_bytes=p_size,created_at=now(),created_by=auth.uid() where file_id=p_file;
 insert into public.portal_admin_events(id,kind,horse_id,file_id,reason,snapshot,actor) values(gen_random_uuid(),'video_preview_replaced',f.horse_id,f.id,'Video preview replaced after review',jsonb_build_object('request_id',p_request,'previous_path',current_preview.object_path,'path',path,'sha256',p_hash,'size_bytes',p_size),auth.uid());
 return p_request;
end;$$;
revoke all on function public.replace_video_preview(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.replace_video_preview(uuid,uuid,text,text,integer) to authenticated;
create or replace function public.portal_files(p_horse uuid default null,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid file page'; end if;
  with matches as (
    select f.id,f.horse_id,h.barn_name as horse_name,f.kind,f.title,f.file_name,f.content_type,f.size_bytes,f.published_at,exists(select 1 from public.horse_video_previews p where p.file_id=f.id) as has_preview,(select p.sha256 from public.horse_video_previews p where p.file_id=f.id) as preview_version from public.horse_files f join public.horses h on h.id=f.horse_id
    join public.customer_horse_access a on a.horse_id=f.horse_id and a.customer_id=customer and a.active
    where f.published_at is not null and f.archived_at is null and (p_horse is null or f.horse_id=p_horse)
    and (a.visible_from is null or (f.published_at at time zone 'America/Chicago')::date>=a.visible_from)
  ), page as(select * from matches order by published_at desc,id limit 24 offset (p_page-1)*24)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by published_at desc,id) from page),'[]'),'total',(select count(*) from matches)) into result;return result;
end $$;
commit;
