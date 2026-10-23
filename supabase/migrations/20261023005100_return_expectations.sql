begin;
create table public.supplier_return_expectations (
 return_id uuid primary key references public.supplier_returns(id),
 version uuid not null unique,
 cash_cents integer check(cash_cents between 0 and 100000000), cash_due date,
 credit_cents integer check(credit_cents between 0 and 100000000), credit_due date,
 notes text check(length(notes)<=2000), updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 check(cash_due is null or cash_cents>0), check(credit_due is null or credit_cents>0)
);
create table public.supplier_return_expectation_history (
 version uuid primary key, return_id uuid not null references public.supplier_returns(id),
 snapshot jsonb not null, created_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
do $$ declare t text; begin foreach t in array array['supplier_return_expectations','supplier_return_expectation_history'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
end loop;end;$$;
create function public.save_supplier_return_expectations(p_return uuid,p_expected uuid,p_version uuid,p_cash integer,p_cash_due date,p_credit integer,p_credit_due date,p_notes text) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.supplier_return_expectations; r public.supplier_returns; old_snapshot jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_version is null or (p_cash is not null and p_cash not between 0 and 100000000) or (p_credit is not null and p_credit not between 0 and 100000000) or (p_cash_due is not null and coalesce(p_cash,0)<=0) or (p_credit_due is not null and coalesce(p_credit,0)<=0) or length(p_notes)>2000 then raise exception 'Enter valid expected amounts; due dates require a positive expected amount';end if;
 select * into r from public.supplier_returns where id=p_return for update;
 if not found or r.cancelled_at is not null then raise exception 'Choose an active return';end if;
 select snapshot into old_snapshot from public.supplier_return_expectation_history where version=p_version;
 if found then
 if row(old_snapshot->>'return_id',old_snapshot->>'cash_cents',old_snapshot->>'cash_due',old_snapshot->>'credit_cents',old_snapshot->>'credit_due',old_snapshot->>'notes') is distinct from row(p_return::text,p_cash::text,p_cash_due::text,p_credit::text,p_credit_due::text,nullif(trim(p_notes),'')) then raise exception 'This form was already saved. Reopen it before making changes';end if;
 return;end if;
 select * into prior from public.supplier_return_expectations where return_id=p_return;
 if prior.version is distinct from p_expected then raise exception 'Expectations changed since this editor opened. Close and reopen it';end if;
 insert into public.supplier_return_expectations(return_id,version,cash_cents,cash_due,credit_cents,credit_due,notes,updated_by)
 values(p_return,p_version,p_cash,p_cash_due,p_credit,p_credit_due,nullif(trim(p_notes),''),auth.uid())
 on conflict(return_id) do update set version=excluded.version,cash_cents=excluded.cash_cents,cash_due=excluded.cash_due,credit_cents=excluded.credit_cents,credit_due=excluded.credit_due,notes=excluded.notes,updated_at=now(),updated_by=excluded.updated_by;
 insert into public.supplier_return_expectation_history(version,return_id,snapshot,created_by)
 select version,return_id,to_jsonb(e),auth.uid() from public.supplier_return_expectations e where return_id=p_return;
end;$$;
revoke all on function public.save_supplier_return_expectations(uuid,uuid,uuid,integer,date,integer,date,text) from public,anon;
grant execute on function public.save_supplier_return_expectations(uuid,uuid,uuid,integer,date,integer,date,text) to authenticated;
create or replace function public.supplier_return_overview(p_page integer default 1,p_return uuid default null,p_refund_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 or p_refund_page is null or p_refund_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 with page as (
 select r.*,m.product_id,p.name as product_name,m.entered_quantity as quantity,m.unit_label,m.movement_date as returned_on,-m.value_delta_cents as stock_cost_cents,
 (select coalesce(sum(amount_cents),0) from public.supplier_refunds where return_id=r.id and reversed_at is null) as refunded_cents,
 (select coalesce(sum(amount_cents),0) from public.supplier_credits where return_id=r.id and cancelled_at is null) as supplier_credit_cents,
 (select count(*) from public.supplier_credits where return_id=r.id and cancelled_at is null) as supplier_credit_count,
 (select to_jsonb(e) from public.supplier_return_expectations e where e.return_id=r.id) as expectation,
 (select count(*) from public.supplier_refunds where return_id=r.id) as refund_count,
 (select coalesce(jsonb_agg(f order by f.created_at desc,f.id),'[]') from (select id,amount_cents,paid_on,reference,notes,reversed_at,reverse_reason,created_at from public.supplier_refunds where return_id=r.id order by created_at desc,id limit 20 offset (p_refund_page-1)*20) f) as refunds
 from public.supplier_returns r join public.inventory_movements m on m.id=r.movement_id join public.inventory_products p on p.id=m.product_id
 where p_return is null or r.id=p_return
 order by r.created_at desc,r.id limit 25 offset (p_page-1)*25
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(page order by created_at desc,id) from page),'[]'),'total',(select count(*) from public.supplier_returns where p_return is null or id=p_return)) into result;
 return result;
end;$$;
commit;
