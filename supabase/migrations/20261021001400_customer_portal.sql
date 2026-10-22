begin;
create table public.customer_portal_accounts (
  customer_id uuid primary key references public.customers(id),user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_email text not null,active boolean not null default true,updated_at timestamptz not null default now()
);
create table public.customer_horse_access (
  customer_id uuid not null references public.customers(id),horse_id uuid not null references public.horses(id),
  visible_from date,active boolean not null default true,updated_at timestamptz not null default now(),primary key(customer_id,horse_id)
);
create table public.horse_updates (
  id uuid primary key,horse_id uuid not null references public.horses(id),update_date date not null,
  title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(trim(body)) between 1 and 10000),
  published_at timestamptz,archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index horse_updates_published on public.horse_updates(horse_id,published_at desc) where archived_at is null and published_at is not null;
create table public.portal_admin_events (
  id uuid primary key,kind text not null,customer_id uuid references public.customers(id),horse_id uuid references public.horses(id),update_id uuid references public.horse_updates(id),
  reason text not null,snapshot jsonb not null,actor uuid not null references auth.users(id),created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['customer_portal_accounts','customer_horse_access','horse_updates','portal_admin_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy portal_admin_only on public.%I for select to authenticated using(public.is_admin())',t);
  end loop;
end $$;
create function public.current_customer_id() returns uuid language sql stable security definer set search_path='' as $$
  select customer_id from public.customer_portal_accounts where user_id=auth.uid() and active;
$$;
create function public.grant_customer_portal(p_request uuid,p_customer uuid,p_email text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare account uuid; prior public.customer_portal_accounts; old public.portal_admin_events; data jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_request is null or p_email is null or length(trim(p_email)) not between 3 and 254 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter the existing sign-in email and an access reason'; end if;
  data:=jsonb_build_object('email',lower(trim(p_email)),'reason',trim(p_reason));
  select * into old from public.portal_admin_events where id=p_request;
  if found then
    if old.kind<>'account_grant' or old.customer_id is distinct from p_customer or old.snapshot->'request' is distinct from data then raise exception 'This access form was already used. Reload before making another change'; end if;return;
  end if;
  perform 1 from public.customers where id=p_customer for update;
  if not found then raise exception 'Customer not found'; end if;
  select id into account from auth.users where lower(email)=lower(trim(p_email));
  if account is null then raise exception 'Create this customer sign-in account in Supabase Authentication first, then link its exact email here'; end if;
  if exists(select 1 from public.customer_portal_accounts where user_id=account and customer_id<>p_customer) then raise exception 'This sign-in account is already linked to another customer'; end if;
  select * into prior from public.customer_portal_accounts where customer_id=p_customer;
  insert into public.customer_portal_accounts(customer_id,user_id,linked_email,active) values(p_customer,account,lower(trim(p_email)),true)
    on conflict(customer_id) do update set user_id=excluded.user_id,linked_email=excluded.linked_email,active=true,updated_at=now();
  insert into public.portal_admin_events(id,kind,customer_id,reason,snapshot,actor) values(p_request,'account_grant',p_customer,trim(p_reason),jsonb_build_object('request',data,'previous',to_jsonb(prior),'user_id',account),auth.uid());
end $$;
create function public.disable_customer_portal(p_customer uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare prior public.customer_portal_accounts;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter an access-change reason'; end if;
  perform 1 from public.customers where id=p_customer for update;
  select * into prior from public.customer_portal_accounts where customer_id=p_customer and active;
  if not found then return; end if;
  update public.customer_portal_accounts set active=false,updated_at=now() where customer_id=p_customer;
  insert into public.portal_admin_events(id,kind,customer_id,reason,snapshot,actor) values(gen_random_uuid(),'account_disabled',p_customer,trim(p_reason),to_jsonb(prior),auth.uid());
end $$;
create function public.set_customer_horse_access(p_request uuid,p_customer uuid,p_horse uuid,p_from date,p_active boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare prior public.customer_horse_access; old public.portal_admin_events; data jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_request is null or p_active is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a horse-access reason'; end if;
  data:=jsonb_build_object('from',p_from,'active',p_active,'reason',trim(p_reason));
  select * into old from public.portal_admin_events where id=p_request;
  if found then
    if old.kind<>'horse_access' or row(old.customer_id,old.horse_id) is distinct from row(p_customer,p_horse) or old.snapshot->'request' is distinct from data then raise exception 'This horse-access form was already used. Reload before making another change'; end if;return;
  end if;
  perform 1 from public.customers where id=p_customer for update;
  if not found or not exists(select 1 from public.horses where id=p_horse) then raise exception 'Choose an existing customer and horse'; end if;
  select * into prior from public.customer_horse_access where customer_id=p_customer and horse_id=p_horse;
  insert into public.customer_horse_access(customer_id,horse_id,visible_from,active) values(p_customer,p_horse,p_from,p_active)
    on conflict(customer_id,horse_id) do update set visible_from=excluded.visible_from,active=excluded.active,updated_at=now();
  insert into public.portal_admin_events(id,kind,customer_id,horse_id,reason,snapshot,actor) values(p_request,'horse_access',p_customer,p_horse,trim(p_reason),jsonb_build_object('request',data,'previous',to_jsonb(prior)),auth.uid());
end $$;
create function public.save_horse_update(p_request uuid,p_id uuid,p_horse uuid,p_date date,p_title text,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare update_id uuid:=coalesce(p_id,p_request); prior public.horse_updates; old public.portal_admin_events;data jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_request is null or p_date is null or p_date>(now() at time zone 'America/Chicago')::date or p_title is null or length(trim(p_title)) not between 1 and 200 or p_body is null or length(trim(p_body)) not between 1 and 10000 then raise exception 'Enter an elapsed date, title, and customer-visible update text'; end if;
  data:=jsonb_build_object('horse_id',p_horse,'date',p_date,'title',trim(p_title),'body',trim(p_body));
  select * into old from public.portal_admin_events where id=p_request;
  if found then
    if old.kind<>'update_saved' or old.update_id is distinct from update_id or old.snapshot->'request' is distinct from data then raise exception 'This update form was already used. Reload before making another change'; end if;return update_id;
  end if;
  if p_id is not null then
    select * into prior from public.horse_updates where id=p_id for update;
    if not found or prior.archived_at is not null or prior.published_at is not null then raise exception 'Only an unarchived draft can be edited. Unpublish first to revise a shared update'; end if;
    update public.horse_updates set horse_id=p_horse,update_date=p_date,title=trim(p_title),body=trim(p_body),updated_at=now() where id=p_id;
  else
    insert into public.horse_updates(id,horse_id,update_date,title,body) values(update_id,p_horse,p_date,trim(p_title),trim(p_body));
  end if;
  insert into public.portal_admin_events(id,kind,horse_id,update_id,reason,snapshot,actor) values(p_request,'update_saved',p_horse,update_id,'Draft saved',jsonb_build_object('request',data,'previous',to_jsonb(prior)),auth.uid());
  return update_id;
end $$;
create function public.change_horse_update(p_id uuid,p_action text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare prior public.horse_updates;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_action is null or p_action not in ('publish','unpublish','archive') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Choose a publication action and reason'; end if;
  select * into prior from public.horse_updates where id=p_id for update;
  if not found then raise exception 'Update not found'; end if;
  if prior.archived_at is not null then raise exception 'Archived updates cannot be published'; end if;
  if p_action='publish' and prior.published_at is not null then return; end if;
  if p_action='unpublish' and prior.published_at is null then return; end if;
  update public.horse_updates set published_at=case p_action when 'publish' then now() else null end,archived_at=case p_action when 'archive' then now() else null end,updated_at=now() where id=p_id;
  insert into public.portal_admin_events(id,kind,horse_id,update_id,reason,snapshot,actor) values(gen_random_uuid(),'update_'||p_action,prior.horse_id,p_id,trim(p_reason),to_jsonb(prior),auth.uid());
end $$;

-- Customer functions deliberately project safe fields instead of opening admin tables.
create function public.portal_horses() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select coalesce(jsonb_agg(x order by barn_name,id),'[]') into result from (
    select h.id,h.barn_name,h.registered_name,h.birth_year,h.sex,h.breed from public.horses h join public.customer_horse_access a on a.horse_id=h.id where a.customer_id=customer and a.active
  ) x;return result;
end $$;
create function public.portal_updates(p_horse uuid default null,p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid update page'; end if;
  with matches as (
    select u.id,u.horse_id,h.barn_name as horse_name,u.title,u.body,u.update_date,u.published_at
    from public.horse_updates u join public.horses h on h.id=u.horse_id join public.customer_horse_access a on a.horse_id=u.horse_id
    where a.customer_id=customer and a.active and u.published_at is not null and u.archived_at is null
      and (p_horse is null or u.horse_id=p_horse) and (a.visible_from is null or (u.published_at at time zone 'America/Chicago')::date>=a.visible_from)
  ), page as (select * from matches order by published_at desc,id limit 25 offset (p_page-1)*25)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by published_at desc,id) from page),'[]'),'total',(select count(*) from matches)) into result;return result;
end $$;
create function public.portal_invoices(p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid invoice page'; end if;
  with matches as (
    select id,invoice_number,issue_date,due_date,status,total_cents,paid_cents,balance_cents from public.invoice_totals where customer_id=customer and status in ('issued','void')
  ), page as (select * from matches order by issue_date desc,id limit 25 offset (p_page-1)*25)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by issue_date desc,id) from page),'[]'),'total',(select count(*) from matches),
    'outstanding_cents',coalesce((select sum(balance_cents) from matches where status='issued' and balance_cents>0),0),
    'overdue_cents',coalesce((select sum(balance_cents) from matches where status='issued' and balance_cents>0 and due_date<(now() at time zone 'America/Chicago')::date),0)) into result;return result;
end $$;
create function public.portal_invoice(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();i public.invoice_totals;result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select * into i from public.invoice_totals where id=p_invoice and customer_id=customer and status in ('issued','void');
  if not found then return null; end if;
  result:=jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'issue_date',i.issue_date,'due_date',i.due_date,'period_from',i.period_from,'period_to',i.period_to,'status',i.status,
    'customer',i.customer_snapshot,'business',i.business_snapshot,'notes',i.notes,'base_cents',i.base_cents,'adjustment_cents',i.adjustment_cents,'total_cents',i.total_cents,'paid_cents',i.paid_cents,'balance_cents',i.balance_cents,
    'lines',coalesce((select jsonb_agg(x order by created_at,id) from (select id,description,amount_cents,created_at from public.invoice_lines where invoice_id=i.id) x),'[]'),
    'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select id,paid_on,amount_cents,method,(reversed_at is not null) as reversed from public.invoice_payments where invoice_id=i.id) x),'[]'),
    'adjustments',coalesce((select jsonb_agg(x order by adjustment_date,id) from (select id,adjustment_date,description,amount_cents from public.invoice_adjustments where invoice_id=i.id) x),'[]'));
  return result;
end $$;
create function public.portal_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select jsonb_build_object('name',c.name,'contact',(select jsonb_build_object('phone',business_phone,'email',business_email) from public.business_settings where singleton=true)) into result from public.customers c where c.id=customer;return result;
end $$;
revoke all on function public.current_customer_id(),public.grant_customer_portal(uuid,uuid,text,text),public.disable_customer_portal(uuid,text),public.set_customer_horse_access(uuid,uuid,uuid,date,boolean,text),public.save_horse_update(uuid,uuid,uuid,date,text,text),public.change_horse_update(uuid,text,text),public.portal_horses(),public.portal_updates(uuid,integer),public.portal_invoices(integer),public.portal_invoice(uuid),public.portal_profile() from public;
grant execute on function public.current_customer_id(),public.grant_customer_portal(uuid,uuid,text,text),public.disable_customer_portal(uuid,text),public.set_customer_horse_access(uuid,uuid,uuid,date,boolean,text),public.save_horse_update(uuid,uuid,uuid,date,text,text),public.change_horse_update(uuid,text,text),public.portal_horses(),public.portal_updates(uuid,integer),public.portal_invoices(integer),public.portal_invoice(uuid),public.portal_profile() to authenticated;
commit;
