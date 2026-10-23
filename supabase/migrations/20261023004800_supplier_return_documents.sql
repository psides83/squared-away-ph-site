insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('supplier-return-documents','supplier-return-documents',false,3145728,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create table public.supplier_return_documents (
 id uuid primary key default gen_random_uuid(), return_id uuid not null references public.supplier_returns(id),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 object_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 200),
 content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 3145728),
 version uuid not null default gen_random_uuid(),
 kind text not null check(kind in ('return_slip','refund_confirmation','other')),
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid() references auth.users(id),
 archived_at timestamptz,archived_by uuid references auth.users(id),archive_reason text,
 unique(return_id,content_hash),
 check(object_path=return_id::text||'/'||content_hash||case content_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.pdf' end)
);
create table public.supplier_return_document_events (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.supplier_return_documents(id),
 operation text not null check(operation in ('archive','restore')),reason text not null check(length(trim(reason)) between 1 and 2000),
 created_at timestamptz not null default now(),created_by uuid not null default auth.uid() references auth.users(id)
);
do $$declare t text;begin foreach t in array array['supplier_return_documents','supplier_return_document_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
end loop;end $$;
create index supplier_return_documents_list on public.supplier_return_documents(return_id,created_at desc,id);
create index supplier_return_document_event_list on public.supplier_return_document_events(document_id,created_at desc,id);
create policy supplier_return_documents_read on storage.objects for select to authenticated using(bucket_id='supplier-return-documents' and (select public.is_admin()));
create policy supplier_return_documents_write on storage.objects for insert to authenticated with check(
 bucket_id='supplier-return-documents' and (select public.is_admin())
 and name ~ '^[a-f0-9-]{36}/[a-f0-9]{64}\.(jpg|png|webp|pdf)$'
 and exists(select 1 from public.supplier_returns r where r.id::text=split_part(name,'/',1))
);
-- Referenced files, including archived documentation, cannot be deleted.
create policy supplier_return_documents_cleanup on storage.objects for delete to authenticated using(
 bucket_id='supplier-return-documents' and (select public.is_admin())
 and not exists(select 1 from public.supplier_return_documents d where d.object_path=name)
);
create function public.register_supplier_return_document(p_return uuid,p_hash text,p_name text,p_type text,p_size integer,p_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; path text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 perform 1 from public.supplier_returns where id=p_return for update;
 if not found then raise exception 'Supplier return not found'; end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_name is null or length(p_name) not between 1 and 200 or p_type is null or p_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size is null or p_size not between 1 and 3145728 or p_kind is null or p_kind not in ('return_slip','refund_confirmation','other') then raise exception 'Choose a supported document up to 3 MB and its document type'; end if;
 select id into result from public.supplier_return_documents where return_id=p_return and content_hash=p_hash;
 if found then return result; end if;
 path:=p_return::text||'/'||p_hash||case p_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.pdf' end;
 if not exists(select 1 from storage.objects where bucket_id='supplier-return-documents' and name=path) then raise exception 'Upload the document before attaching it'; end if;
 insert into public.supplier_return_documents(return_id,content_hash,object_path,file_name,content_type,size_bytes,kind) values(p_return,p_hash,path,p_name,p_type,p_size,p_kind) returning id into result;
 return result;
end; $$;
create function public.set_supplier_return_document_archived(p_document uuid,p_archived boolean,p_reason text,p_expected uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.supplier_return_documents%rowtype;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_archived is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a documentation correction reason'; end if;
 select * into d from public.supplier_return_documents where id=p_document for update;
 if not found then raise exception 'Document not found'; end if;
 if (d.archived_at is not null)=p_archived then return; end if;
 if d.version is distinct from p_expected then raise exception 'This document changed. Close and reopen the correction form before saving'; end if;
 update public.supplier_return_documents set version=gen_random_uuid(),archived_at=case when p_archived then now() else null end,archived_by=case when p_archived then auth.uid() else null end,archive_reason=case when p_archived then trim(p_reason) else null end where id=d.id;
 insert into public.supplier_return_document_events(document_id,operation,reason) values(d.id,case when p_archived then 'archive' else 'restore' end,trim(p_reason));
end; $$;
revoke all on function public.register_supplier_return_document(uuid,text,text,text,integer,text),public.set_supplier_return_document_archived(uuid,boolean,text,uuid) from public,anon;
grant execute on function public.register_supplier_return_document(uuid,text,text,text,integer,text),public.set_supplier_return_document_archived(uuid,boolean,text,uuid) to authenticated;
