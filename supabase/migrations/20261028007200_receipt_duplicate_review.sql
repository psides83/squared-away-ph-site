begin;
alter table public.inventory_receipt_purchases add column receipt_sha256 text check(receipt_sha256 is null or (length(receipt_sha256)=64 and receipt_sha256~'^[0-9a-f]{64}$'));
update public.inventory_receipt_purchases set receipt_sha256=payload->'header'->>'receipt_sha256' where payload->'header'->>'receipt_sha256'~'^[0-9a-f]{64}$';
create index receipt_purchase_photo on public.inventory_receipt_purchases(receipt_sha256) where receipt_sha256 is not null;
-- Older attachments made by the content-addressed uploader are searchable without fetching private files.
alter table public.expense_receipts add column content_sha256 text generated always as(case when split_part(object_path,'/',2)~'^[0-9a-f]{64}\.(jpg|png|webp|pdf)$' then left(split_part(object_path,'/',2),64) end) stored;
create index expense_receipt_photo on public.expense_receipts(content_sha256,expense_id) where content_sha256 is not null;
create table public.receipt_duplicate_overrides(
 receipt_id uuid primary key references public.inventory_receipt_purchases(id),reason text not null check(length(trim(reason)) between 1 and 2000),
 review_token text not null,matching_records jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table public.receipt_duplicate_overrides enable row level security;
revoke all on public.receipt_duplicate_overrides from public,anon,authenticated;
grant select on public.receipt_duplicate_overrides to authenticated;
create policy admin_read on public.receipt_duplicate_overrides for select to authenticated using(public.is_admin());
create function public.receipt_duplicate_snapshot(p_hash text,p_exclude uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'vendor',e.vendor,'expense_date',e.expense_date,'amount_cents',e.amount_cents) order by e.id),'[]'::jsonb)
 from public.expenses e join (
  select id from public.inventory_receipt_purchases where receipt_sha256=p_hash
  union select expense_id from public.expense_receipts where content_sha256=p_hash
 ) matches on matches.id=e.id where e.voided_at is null and e.id is distinct from p_exclude
$$;
revoke all on function public.receipt_duplicate_snapshot(text,uuid) from public,anon,authenticated;
create function public.review_receipt_photo(p_hash text,p_exclude uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_hash is null or length(p_hash)<>64 or p_hash!~'^[0-9a-f]{64}$' then raise exception 'Choose a valid receipt photo';end if;
 snapshot:=public.receipt_duplicate_snapshot(p_hash,p_exclude);
 return jsonb_build_object('count',jsonb_array_length(snapshot),'token',md5(snapshot::text),'matches',snapshot);
end;$$;
revoke all on function public.review_receipt_photo(text,uuid) from public,anon;
grant execute on function public.review_receipt_photo(text,uuid) to authenticated;
alter function public.record_receipt_purchase(uuid,jsonb,jsonb) rename to record_receipt_purchase_with_ocr;
revoke all on function public.record_receipt_purchase_with_ocr(uuid,jsonb,jsonb) from public,anon,authenticated;
create function public.record_receipt_purchase(p_request uuid,p_header jsonb,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare digest text;snapshot jsonb;reason text;saved uuid;scan uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 scan:=nullif(p_header->>'ocr_read_id','')::uuid;
 if scan is not null and not exists(select 1 from public.receipt_ocr_reads where id=scan and user_id=auth.uid() and state='complete' and image_sha256=p_header->>'receipt_sha256') then raise exception 'Receipt photo does not match its completed read. Re-read the selected photo or use manual entry';end if;
 -- Match the original request lock, then serialize new purchases of the same fingerprint.
 if p_request is null then raise exception 'Enter a receipt request identifier';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,741853170));
 if exists(select 1 from public.inventory_receipt_purchases where id=p_request) then
  return public.record_receipt_purchase_with_ocr(p_request,p_header,p_lines);
 end if;
 digest:=nullif(p_header->>'receipt_sha256','');
 if digest is not null then
  if length(digest)<>64 or digest!~'^[0-9a-f]{64}$' then raise exception 'Choose a valid receipt photo';end if;
  perform pg_advisory_xact_lock(hashtextextended(digest,741853172));
  snapshot:=public.receipt_duplicate_snapshot(digest,p_request);
  if jsonb_array_length(snapshot)>0 then
   reason:=trim(p_header->>'duplicate_reason');
   if p_header->>'duplicate_review_token' is distinct from md5(snapshot::text) or reason is null or length(reason) not between 1 and 2000 then
    raise exception 'This receipt file matches existing expenses. Review the matches and explain why this is another purchase before saving' using hint='review_receipt_duplicate';
   end if;
  end if;
 end if;
 saved:=public.record_receipt_purchase_with_ocr(p_request,p_header,p_lines);
 if digest is not null then update public.inventory_receipt_purchases set receipt_sha256=digest where id=saved;end if;
 if reason is not null then insert into public.receipt_duplicate_overrides(receipt_id,reason,review_token,matching_records,created_by) values(saved,reason,md5(snapshot::text),snapshot,auth.uid());end if;
 return saved;
end;$$;
revoke all on function public.record_receipt_purchase(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.record_receipt_purchase(uuid,jsonb,jsonb) to authenticated;
commit;
