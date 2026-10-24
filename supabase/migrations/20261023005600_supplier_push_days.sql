begin;
alter table public.admin_push_devices add column supplier_days integer[] not null default array[1,2,3,4,5,6,7]
 check(cardinality(supplier_days) between 1 and 7 and supplier_days <@ array[1,2,3,4,5,6,7] and array_position(supplier_days,null) is null);
create function public.validate_supplier_push_days(p_days integer[]) returns void
language plpgsql immutable set search_path='' as $$
begin
 if p_days is null or cardinality(p_days) not between 1 and 7 or not (p_days <@ array[1,2,3,4,5,6,7]) or array_position(p_days,null) is not null or (select count(distinct d) from unnest(p_days) d)<>cardinality(p_days) then raise exception 'Select at least one reminder day, using each day once';end if;
end;$$;
revoke all on function public.validate_supplier_push_days(integer[]) from public,anon,authenticated;
create function public.save_admin_push_device_schedule(p_endpoint text,p_p256dh text,p_auth text,p_public text,p_label text,p_supplier boolean,p_scheduler boolean,p_days integer[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 perform public.validate_supplier_push_days(p_days);
 saved:=public.save_admin_push_device(p_endpoint,p_p256dh,p_auth,p_public,p_label,p_supplier,p_scheduler);
 update public.admin_push_devices set supplier_days=(select array_agg(d order by d) from unnest(p_days) d) where id=saved;
 return saved;
end;$$;
create function public.update_admin_push_device_schedule(p_id uuid,p_label text,p_supplier boolean,p_scheduler boolean,p_enabled boolean,p_days integer[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 perform public.validate_supplier_push_days(p_days);
 perform public.update_admin_push_device(p_id,p_label,p_supplier,p_scheduler,p_enabled);
 update public.admin_push_devices set supplier_days=(select array_agg(d order by d) from unnest(p_days) d) where id=p_id and user_id=auth.uid();
 update public.admin_push_deliveries set state='expired',lease_token=null,lease_until=null where device_id=p_id and kind='supplier' and state in ('pending','failed') and not (extract(isodow from (now() at time zone 'America/Chicago')::date)::integer=any(p_days));
end;$$;
revoke all on function public.save_admin_push_device_schedule(text,text,text,text,text,boolean,boolean,integer[]),public.update_admin_push_device_schedule(uuid,text,boolean,boolean,boolean,integer[]) from public,anon;
grant execute on function public.save_admin_push_device_schedule(text,text,text,text,text,boolean,boolean,integer[]),public.update_admin_push_device_schedule(uuid,text,boolean,boolean,boolean,integer[]) to authenticated;
create or replace function public.claim_admin_push(p_public text,p_scheduler_failed boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'America/Chicago')::date; has_overdue boolean; result jsonb;
begin
 if not pg_try_advisory_xact_lock(741853155) then return '[]'::jsonb;end if;
 select exists(select 1 from public.supplier_return_expectations e join public.supplier_returns r on r.id=e.return_id where r.cancelled_at is null and
 ((e.cash_due<today and e.cash_cents>coalesce((select sum(amount_cents) from public.supplier_refunds where return_id=r.id and reversed_at is null),0)) or
 (e.credit_due<today and e.credit_cents>coalesce((select sum(amount_cents) from public.supplier_credits where return_id=r.id and cancelled_at is null),0)))) into has_overdue;
 update public.admin_push_deliveries j set state='expired',lease_token=null,lease_until=null
 where j.state in ('pending','failed','sending') and (j.business_date<today or (j.kind='supplier' and not has_overdue) or not exists(select 1 from public.admin_push_devices d join public.admin_users a on a.user_id=d.user_id where d.id=j.device_id and d.enabled and d.vapid_public=p_public and case when j.kind='supplier' then d.supplier_alerts and extract(isodow from today)::integer=any(d.supplier_days) else d.scheduler_alerts end));
 insert into public.admin_push_deliveries(device_id,kind,business_date)
 select d.id,k.kind,today from public.admin_push_devices d join public.admin_users a on a.user_id=d.user_id cross join (values('supplier'),('scheduler')) k(kind)
 where d.enabled and d.vapid_public=p_public and ((k.kind='supplier' and d.supplier_alerts and extract(isodow from today)::integer=any(d.supplier_days) and has_overdue) or(k.kind='scheduler' and d.scheduler_alerts and p_scheduler_failed)) on conflict(device_id,kind,business_date) do nothing;
 with chosen as (select id from public.admin_push_deliveries where business_date=today and attempts<3 and
 (state='pending' or(state='failed' and last_attempt_at<now()-interval '5 minutes') or(state='sending' and lease_until<now())) order by created_at,id limit 20 for update skip locked),claimed as (
 update public.admin_push_deliveries j set state='sending',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',last_attempt_at=now(),device_version=d.version
 from chosen c,public.admin_push_devices d where j.id=c.id and d.id=j.device_id and d.enabled and d.vapid_public=p_public
 returning j.id,j.kind,j.lease_token,j.device_id,d.endpoint,d.p256dh,d.auth_key
 ) select coalesce(jsonb_agg(claimed),'[]') into result from claimed;
 -- Retain only 90 days of operational delivery history; financial records are untouched.
 delete from public.admin_push_deliveries where id in (select id from public.admin_push_deliveries where business_date<today-90 and state<>'sending' order by business_date,id limit 500);
 return result;
end;$$;
commit;
