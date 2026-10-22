begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('horse-files','horse-files',false,3145728,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table public.horse_files (
  id uuid primary key,horse_id uuid not null references public.horses(id),kind text not null check(kind in ('photo','document')),
  title text not null check(length(trim(title)) between 1 and 200),file_name text not null check(length(file_name) between 1 and 200),object_path text not null unique,
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','application/pdf')),size_bytes integer not null check(size_bytes between 1 and 3145728),
  check(kind<>'photo' or content_type<>'application/pdf'),created_at timestamptz not null default now(),published_at timestamptz,archived_at timestamptz
);
create index horse_files_horse on public.horse_files(horse_id,created_at desc);
alter table public.portal_admin_events add column file_id uuid references public.horse_files(id);
alter table public.horse_files enable row level security;
revoke all on public.horse_files from anon,authenticated;
grant select on public.horse_files to authenticated;
create policy horse_files_admin on public.horse_files for select to authenticated using(public.is_admin());
create function public.can_access_horse_file(p_path text) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or exists(
    select 1 from public.horse_files f join public.customer_horse_access a on a.horse_id=f.horse_id
    where f.object_path=p_path and f.published_at is not null and f.archived_at is null and a.customer_id=public.current_customer_id() and a.active
    and (a.visible_from is null or (f.published_at at time zone 'America/Chicago')::date>=a.visible_from)
  );
$$;
create policy horse_files_storage_read on storage.objects for select to authenticated using(bucket_id='horse-files' and public.can_access_horse_file(name));
create policy horse_files_storage_insert on storage.objects for insert to authenticated with check(bucket_id='horse-files' and public.is_admin());
create policy horse_files_storage_delete on storage.objects for delete to authenticated using(bucket_id='horse-files' and public.is_admin());
create function public.attach_horse_file(p_id uuid,p_horse uuid,p_kind text,p_title text,p_name text,p_path text,p_type text,p_size integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.horse_files;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_id is null or p_horse is null or p_path is null or p_path !~ ('^'||p_horse::text||'/'||p_id::text||'\.(jpg|png|webp|pdf)$') then raise exception 'Invalid horse file path'; end if;
  select * into old from public.horse_files where id=p_id;
  if found then
    if row(old.horse_id,old.kind,old.title,old.file_name,old.object_path,old.content_type,old.size_bytes) is distinct from row(p_horse,p_kind,trim(p_title),p_name,p_path,p_type,p_size) then raise exception 'This file form was already used'; end if;return p_id;
  end if;
  if not exists(select 1 from storage.objects where bucket_id='horse-files' and name=p_path) then raise exception 'Upload the private file before attaching it'; end if;
  insert into public.horse_files(id,horse_id,kind,title,file_name,object_path,content_type,size_bytes) values(p_id,p_horse,p_kind,trim(p_title),p_name,p_path,p_type,p_size);
  insert into public.portal_admin_events(id,kind,horse_id,file_id,reason,snapshot,actor) values(gen_random_uuid(),'file_attached',p_horse,p_id,'Private file uploaded',jsonb_build_object('title',trim(p_title),'path',p_path),auth.uid());
  return p_id;
end $$;
create function public.change_horse_file(p_id uuid,p_action text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare f public.horse_files;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_action is null or p_action not in ('publish','unpublish','archive') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Choose a file publication action and reason'; end if;
  select * into f from public.horse_files where id=p_id for update;
  if not found then raise exception 'File not found'; end if;
  if f.archived_at is not null then raise exception 'Archived files cannot be published'; end if;
  if p_action='publish' and f.published_at is not null then return; end if;
  if p_action='unpublish' and f.published_at is null then return; end if;
  update public.horse_files set published_at=case p_action when 'publish' then now() else null end,archived_at=case p_action when 'archive' then now() else null end where id=p_id;
  insert into public.portal_admin_events(id,kind,horse_id,file_id,reason,snapshot,actor) values(gen_random_uuid(),'file_'||p_action,f.horse_id,f.id,trim(p_reason),to_jsonb(f),auth.uid());
end $$;
create function public.portal_files(p_horse uuid default null,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid file page'; end if;
  with matches as (
    select f.id,f.horse_id,h.barn_name as horse_name,f.kind,f.title,f.file_name,f.content_type,f.size_bytes,f.published_at from public.horse_files f join public.horses h on h.id=f.horse_id
    join public.customer_horse_access a on a.horse_id=f.horse_id and a.customer_id=customer and a.active
    where f.published_at is not null and f.archived_at is null and (p_horse is null or f.horse_id=p_horse)
    and (a.visible_from is null or (f.published_at at time zone 'America/Chicago')::date>=a.visible_from)
  ), page as(select * from matches order by published_at desc,id limit 24 offset (p_page-1)*24)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by published_at desc,id) from page),'[]'),'total',(select count(*) from matches)) into result;return result;
end $$;
create function public.portal_file(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select jsonb_build_object('path',f.object_path,'name',f.file_name,'type',f.content_type) into result from public.horse_files f
    where f.id=p_id and public.can_access_horse_file(f.object_path);return result;
end $$;
revoke all on function public.can_access_horse_file(text),public.attach_horse_file(uuid,uuid,text,text,text,text,text,integer),public.change_horse_file(uuid,text,text),public.portal_files(uuid,integer),public.portal_file(uuid) from public;
grant execute on function public.can_access_horse_file(text),public.attach_horse_file(uuid,uuid,text,text,text,text,text,integer),public.change_horse_file(uuid,text,text),public.portal_files(uuid,integer),public.portal_file(uuid) to authenticated;
create function public.rename_horse_file(p_id uuid,p_title text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare f public.horse_files;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a file title and revision reason'; end if;
  select * into f from public.horse_files where id=p_id for update;
  if not found or f.archived_at is not null or f.published_at is not null then raise exception 'Unpublish an unarchived file before changing its title'; end if;
  if f.title=trim(p_title) then return; end if;
  update public.horse_files set title=trim(p_title) where id=p_id;
  insert into public.portal_admin_events(id,kind,horse_id,file_id,reason,snapshot,actor) values(gen_random_uuid(),'file_renamed',f.horse_id,f.id,trim(p_reason),to_jsonb(f),auth.uid());
end $$;
revoke all on function public.rename_horse_file(uuid,text,text) from public;
grant execute on function public.rename_horse_file(uuid,text,text) to authenticated;
commit;
