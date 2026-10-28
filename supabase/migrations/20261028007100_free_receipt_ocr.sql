begin;
create table public.receipt_ocr_reads(
 id uuid primary key,user_id uuid not null references auth.users(id),image_sha256 text not null check(length(image_sha256)=64 and image_sha256~'^[0-9a-f]{64}$'),
 provider text not null default 'ocr.space/free-engine2' check(provider='ocr.space/free-engine2'),parser_version integer not null default 1 check(parser_version=1),
 state text not null default 'pending' check(state in ('pending','complete','failed')),lease_token uuid not null default gen_random_uuid(),
 extracted_text text check(length(extracted_text)<=40000),created_at timestamptz not null default now(),finished_at timestamptz
);
create index receipt_ocr_created on public.receipt_ocr_reads(created_at);
alter table public.receipt_ocr_reads enable row level security;
revoke all on public.receipt_ocr_reads from public,anon,authenticated;
grant select on public.receipt_ocr_reads to authenticated;
create policy admin_own_reads on public.receipt_ocr_reads for select to authenticated using(public.is_admin() and user_id=auth.uid());
alter table public.inventory_receipt_purchases add column ocr_read_id uuid references public.receipt_ocr_reads(id);
create function public.reserve_receipt_ocr(p_request uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.receipt_ocr_reads;day_start timestamptz;month_start timestamptz;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_hash is null or length(p_hash)<>64 or p_hash!~'^[0-9a-f]{64}$' then raise exception 'Select a valid receipt photo';end if;
 perform pg_advisory_xact_lock(741853171);
 update public.receipt_ocr_reads set state='failed',finished_at=now() where state='pending' and created_at<now()-interval '2 minutes';
 select * into r from public.receipt_ocr_reads where id=p_request;
 if found then
  if r.user_id<>auth.uid() or r.image_sha256<>p_hash then raise exception 'This read request was already used for a different photo';end if;
  if r.state='pending' and r.created_at<now()-interval '2 minutes' then update public.receipt_ocr_reads set state='failed',finished_at=now() where id=r.id; r.state:='failed';end if;
  return jsonb_build_object('send',false,'state',r.state,'text',case when r.state='complete' then r.extracted_text end);
 end if;
 day_start:=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago';month_start:=date_trunc('month',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
 if (select count(*) from public.receipt_ocr_reads where created_at>=day_start)>=20 or (select count(*) from public.receipt_ocr_reads where created_at>=month_start)>=200 then raise exception 'Free receipt reading limit reached (20 per day, 200 per month). Enter this receipt manually';end if;
 if exists(select 1 from public.receipt_ocr_reads where user_id=auth.uid() and created_at>now()-interval '1 minute') then raise exception 'Wait one minute before starting another receipt read';end if;
 insert into public.receipt_ocr_reads(id,user_id,image_sha256) values(p_request,auth.uid(),p_hash) returning * into r;
 return jsonb_build_object('send',true,'state','pending','token',r.lease_token);
end;$$;
revoke all on function public.reserve_receipt_ocr(uuid,text) from public,anon;
grant execute on function public.reserve_receipt_ocr(uuid,text) to authenticated;
create function public.finish_receipt_ocr(p_request uuid,p_token uuid,p_text text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_text is not null and length(trim(p_text)) not between 1 and 40000 then raise exception 'Receipt text is outside the supported limit';end if;
 update public.receipt_ocr_reads set state=case when p_text is null then 'failed' else 'complete' end,extracted_text=p_text,finished_at=now() where id=p_request and lease_token=p_token and state='pending' and created_at>=now()-interval '2 minutes';
 if not found then raise exception 'This receipt read expired or was already completed';end if;
end;$$;
revoke all on function public.finish_receipt_ocr(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_receipt_ocr(uuid,uuid,text) to service_role;
-- Keep manual purchases backward compatible; only linked scans need a verified retained result/hash.
alter function public.record_receipt_purchase(uuid,jsonb,jsonb) rename to record_receipt_purchase_without_ocr;
revoke all on function public.record_receipt_purchase_without_ocr(uuid,jsonb,jsonb) from public,anon,authenticated;
create function public.record_receipt_purchase(p_request uuid,p_header jsonb,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare scan uuid;saved uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 scan:=nullif(p_header->>'ocr_read_id','')::uuid;
 if scan is not null and not exists(select 1 from public.receipt_ocr_reads where id=scan and user_id=auth.uid() and state='complete' and image_sha256=p_header->>'receipt_sha256') then raise exception 'Receipt photo does not match its completed read. Re-read the selected photo or use manual entry';end if;
 saved:=public.record_receipt_purchase_without_ocr(p_request,p_header,p_lines);
 if scan is not null then update public.inventory_receipt_purchases set ocr_read_id=scan where id=saved;end if;
 return saved;
end;$$;
revoke all on function public.record_receipt_purchase(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.record_receipt_purchase(uuid,jsonb,jsonb) to authenticated;
commit;
