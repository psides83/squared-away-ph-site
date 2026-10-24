begin;
create table public.admin_push_devices (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),endpoint text not null unique check(length(endpoint)<=2048),
 p256dh text not null,auth_key text not null,vapid_public text not null,label text not null check(length(trim(label)) between 1 and 80),
 supplier_alerts boolean not null default true,scheduler_alerts boolean not null default true,enabled boolean not null default true,
 last_test_at timestamptz,version uuid not null default gen_random_uuid(),updated_at timestamptz not null default now()
);
create table public.admin_push_deliveries (
 id uuid primary key default gen_random_uuid(),device_id uuid not null references public.admin_push_devices(id),kind text not null check(kind in ('supplier','scheduler')),
 business_date date not null,state text not null default 'pending' check(state in ('pending','sending','sent','failed','expired')),
 attempts integer not null default 0,lease_token uuid,lease_until timestamptz,device_version uuid,
 last_attempt_at timestamptz,sent_at timestamptz,error_code integer,created_at timestamptz not null default now(),unique(device_id,kind,business_date)
);
do $$ declare t text;begin foreach t in array array['admin_push_devices','admin_push_deliveries'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
end loop;end;$$;
create policy own_admin_device on public.admin_push_devices for select to authenticated using ((select public.is_admin()) and user_id=(select auth.uid()));
create policy own_admin_delivery on public.admin_push_deliveries for select to authenticated using ((select public.is_admin()) and exists(select 1 from public.admin_push_devices d where d.id=device_id and d.user_id=(select auth.uid())));
create function public.save_admin_push_device(p_endpoint text,p_p256dh text,p_auth text,p_public text,p_label text,p_supplier boolean,p_scheduler boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.admin_push_devices; saved uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_endpoint is null or length(p_endpoint)>2048 or p_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-zA-Z0-9-]+[.]notify[.]windows[.]com)/[^#[:space:]]+$' or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' or p_public is null or p_public !~ '^[A-Za-z0-9_-]{87}$' or p_label is null or length(trim(p_label)) not between 1 and 80 or p_supplier is null or p_scheduler is null then raise exception 'Invalid device subscription. Reconnect this device';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 perform pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
 select * into prior from public.admin_push_devices where endpoint=p_endpoint for update;
 if found and prior.user_id<>auth.uid() then raise exception 'This browser subscription belongs to another account. Disconnect it in the browser first';end if;
 if (prior.id is null or not prior.enabled) and (select count(*) from public.admin_push_devices where user_id=auth.uid() and enabled)>=10 then raise exception 'Disable an old device before adding another (maximum 10 active devices)';end if;
 insert into public.admin_push_devices(user_id,endpoint,p256dh,auth_key,vapid_public,label,supplier_alerts,scheduler_alerts) values(auth.uid(),p_endpoint,p_p256dh,p_auth,p_public,trim(p_label),p_supplier,p_scheduler)
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,vapid_public=excluded.vapid_public,label=excluded.label,supplier_alerts=excluded.supplier_alerts,scheduler_alerts=excluded.scheduler_alerts,enabled=true,version=gen_random_uuid(),updated_at=now() returning id into saved;
 return saved;
end;$$;
create function public.update_admin_push_device(p_id uuid,p_label text,p_supplier boolean,p_scheduler boolean,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_label is null or length(trim(p_label)) not between 1 and 80 or p_supplier is null or p_scheduler is null or p_enabled is null then raise exception 'Enter valid device preferences';end if;
 -- Re-enabling requires a browser subscription, so an expired endpoint is never blindly revived here.
 update public.admin_push_devices set label=trim(p_label),supplier_alerts=p_supplier,scheduler_alerts=p_scheduler,enabled=case when p_enabled then enabled else false end,version=gen_random_uuid(),updated_at=now() where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Device not found';end if;
 update public.admin_push_deliveries j set state='expired',lease_token=null,lease_until=null where device_id=p_id and state in ('pending','failed') and (not p_enabled or (kind='supplier' and not p_supplier) or (kind='scheduler' and not p_scheduler));
end;$$;
create function public.claim_admin_push(p_public text,p_scheduler_failed boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date := (now() at time zone 'America/Chicago')::date; has_overdue boolean; result jsonb;
begin
 if not pg_try_advisory_xact_lock(741853155) then return '[]'::jsonb;end if;
 select exists(select 1 from public.supplier_return_expectations e join public.supplier_returns r on r.id=e.return_id where r.cancelled_at is null and
 ((e.cash_due<today and e.cash_cents>coalesce((select sum(amount_cents) from public.supplier_refunds where return_id=r.id and reversed_at is null),0)) or
 (e.credit_due<today and e.credit_cents>coalesce((select sum(amount_cents) from public.supplier_credits where return_id=r.id and cancelled_at is null),0)))) into has_overdue;
 update public.admin_push_deliveries j set state='expired',lease_token=null,lease_until=null
 where j.state in ('pending','failed','sending') and (j.business_date<today or (j.kind='supplier' and not has_overdue) or not exists(select 1 from public.admin_push_devices d join public.admin_users a on a.user_id=d.user_id where d.id=j.device_id and d.enabled and d.vapid_public=p_public and case when j.kind='supplier' then d.supplier_alerts else d.scheduler_alerts end));
 insert into public.admin_push_deliveries(device_id,kind,business_date)
 select d.id,k.kind,today from public.admin_push_devices d join public.admin_users a on a.user_id=d.user_id cross join (values('supplier'),('scheduler')) k(kind)
 where d.enabled and d.vapid_public=p_public and ((k.kind='supplier' and d.supplier_alerts and has_overdue) or(k.kind='scheduler' and d.scheduler_alerts and p_scheduler_failed)) on conflict(device_id,kind,business_date) do nothing;
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
create function public.finish_admin_push(p_id uuid,p_token uuid,p_status text,p_code integer default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.admin_push_deliveries;
begin
 if p_status not in ('sent','failed','expired') or p_status is null then raise exception 'Invalid delivery result';end if;
 update public.admin_push_deliveries set state=p_status,sent_at=case when p_status='sent' then now() else null end,error_code=p_code,lease_until=null
 where id=p_id and state='sending' and lease_token=p_token returning * into j;
 if found and p_status='expired' and p_code in (404,410) then
 update public.admin_push_devices set enabled=false,version=gen_random_uuid(),updated_at=now() where id=j.device_id and version=j.device_version;
 end if;
end;$$;
revoke all on function public.save_admin_push_device(text,text,text,text,text,boolean,boolean),public.update_admin_push_device(uuid,text,boolean,boolean,boolean),public.claim_admin_push(text,boolean),public.finish_admin_push(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.save_admin_push_device(text,text,text,text,text,boolean,boolean),public.update_admin_push_device(uuid,text,boolean,boolean,boolean) to authenticated;
grant execute on function public.claim_admin_push(text,boolean),public.finish_admin_push(uuid,uuid,text,integer) to service_role;
create function public.reserve_admin_push_test(p_id uuid,p_public text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.admin_push_devices;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into d from public.admin_push_devices where id=p_id and user_id=auth.uid() and enabled and vapid_public=p_public for update;
 if not found then raise exception 'Reconnect this device before sending a test';end if;
 if d.last_test_at>now()-interval '1 minute' then raise exception 'Wait one minute before sending another test';end if;
 update public.admin_push_devices set last_test_at=now() where id=d.id;
 return jsonb_build_object('endpoint',d.endpoint,'keys',jsonb_build_object('p256dh',d.p256dh,'auth',d.auth_key));
end;$$;
revoke all on function public.reserve_admin_push_test(uuid,text) from public,anon;
grant execute on function public.reserve_admin_push_test(uuid,text) to authenticated;
commit;
