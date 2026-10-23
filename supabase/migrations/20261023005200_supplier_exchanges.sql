begin;
-- Exchange links describe relationships only: no amounts, stock or payments are inferred.
create table public.supplier_exchange_links (
 id uuid primary key,
 return_id uuid not null references public.supplier_returns(id),
 expense_id uuid not null references public.expenses(id),
 notes text check(length(notes)<=2000),
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 removed_at timestamptz, removed_by uuid references auth.users(id), remove_reason text,
 check((removed_at is null and removed_by is null and remove_reason is null) or
       (removed_at is not null and removed_by is not null and length(trim(remove_reason)) between 1 and 2000))
);
create unique index supplier_exchange_active_pair on public.supplier_exchange_links(return_id,expense_id) where removed_at is null;
create index supplier_exchange_expense on public.supplier_exchange_links(expense_id,created_at desc);
alter table public.supplier_exchange_links enable row level security;
revoke all on public.supplier_exchange_links from public,anon,authenticated;
grant select on public.supplier_exchange_links to authenticated;
create policy admin_read on public.supplier_exchange_links for select to authenticated using ((select public.is_admin()));
create function public.link_supplier_exchange(p_request uuid,p_return uuid,p_expense uuid,p_notes text) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.supplier_exchange_links; r public.supplier_returns; e public.expenses;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or length(p_notes)>2000 then raise exception 'Enter valid exchange details';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.supplier_exchange_links where id=p_request;
 if found then
 if row(prior.return_id,prior.expense_id,prior.notes) is distinct from row(p_return,p_expense,nullif(trim(p_notes),'')) then raise exception 'This form was already saved. Open a new form';end if;
 return prior.id; -- Exact late retries never restore removed links.
 end if;
 select * into r from public.supplier_returns where id=p_return for update;
 if not found or r.cancelled_at is not null then raise exception 'Choose an active supplier return';end if;
 select * into e from public.expenses where id=p_expense for update;
 if not found or e.voided_at is not null or not exists(select 1 from public.inventory_movements where expense_id=e.id and kind='purchase') then raise exception 'Choose an active inventory purchase expense';end if;
 if public.supplier_vendor_key(r.vendor) is distinct from public.supplier_vendor_key(e.vendor) then raise exception 'The replacement purchase must use the same supplier';end if;
 if exists(select 1 from public.supplier_exchange_links where return_id=p_return and expense_id=p_expense and removed_at is null) then raise exception 'This purchase is already linked to the return';end if;
 insert into public.supplier_exchange_links(id,return_id,expense_id,notes,created_by) values(p_request,p_return,p_expense,nullif(trim(p_notes),''),auth.uid());
 return p_request;
end;$$;
create function public.remove_supplier_exchange(p_link uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare prior public.supplier_exchange_links;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a reason for removing the link';end if;
 select * into prior from public.supplier_exchange_links where id=p_link;
 if not found then raise exception 'Exchange link not found';end if;
 perform 1 from public.supplier_returns where id=prior.return_id for update;
 perform 1 from public.expenses where id=prior.expense_id for update;
 update public.supplier_exchange_links set removed_at=now(),removed_by=auth.uid(),remove_reason=trim(p_reason) where id=p_link and removed_at is null;
end;$$;
create function public.guard_supplier_exchange_expense() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.voided_at is not null or public.supplier_vendor_key(new.vendor) is distinct from public.supplier_vendor_key(old.vendor)) and exists(select 1 from public.supplier_exchange_links where expense_id=old.id and removed_at is null) then raise exception 'Remove active exchange links before voiding this purchase or changing its supplier';end if;
 return new;
end;$$;
create trigger supplier_exchange_expense_guard before update on public.expenses for each row execute function public.guard_supplier_exchange_expense();
create function public.guard_supplier_exchange_return() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.cancelled_at is not null and old.cancelled_at is null and exists(select 1 from public.supplier_exchange_links where return_id=old.id and removed_at is null) then raise exception 'Remove active replacement purchase links before cancelling this return';end if;
 return new;
end;$$;
create trigger supplier_exchange_return_guard before update on public.supplier_returns for each row execute function public.guard_supplier_exchange_return();
create function public.supplier_return_exchanges(p_return uuid,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.supplier_returns; result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 10000 then raise exception 'Choose a valid page';end if;
 select * into r from public.supplier_returns where id=p_return;
 if not found then raise exception 'Supplier return not found';end if;
 select jsonb_build_object('vendor',r.vendor,'cancelled',r.cancelled_at is not null,
 'total',(select count(*) from public.supplier_exchange_links where return_id=r.id),
 'rows',coalesce((select jsonb_agg(x order by created_at desc,id) from (
 select l.*,e.vendor,e.expense_date,e.amount_cents,e.paid_on,e.voided_at,
 (select string_agg(distinct p.name,', ' order by p.name) from public.inventory_movements m join public.inventory_products p on p.id=m.product_id where m.expense_id=e.id and m.kind='purchase') as products
 from public.supplier_exchange_links l join public.expenses e on e.id=l.expense_id where l.return_id=r.id order by l.created_at desc,l.id limit 25 offset (p_page-1)*25) x),'[]'),
 'eligible',coalesce((select jsonb_agg(x order by expense_date desc,id) from (
 select e.id,e.vendor,e.expense_date,e.amount_cents,e.paid_on,
 (select string_agg(distinct p.name,', ' order by p.name) from public.inventory_movements m join public.inventory_products p on p.id=m.product_id where m.expense_id=e.id and m.kind='purchase') as products
 from public.expenses e where r.cancelled_at is null and e.voided_at is null and public.supplier_vendor_key(e.vendor)=public.supplier_vendor_key(r.vendor)
 and exists(select 1 from public.inventory_movements where expense_id=e.id and kind='purchase')
 and not exists(select 1 from public.supplier_exchange_links where return_id=r.id and expense_id=e.id and removed_at is null)
 order by e.expense_date desc,e.id limit 100) x),'[]')) into result;
 return result;
end;$$;
revoke all on function public.link_supplier_exchange(uuid,uuid,uuid,text), public.remove_supplier_exchange(uuid,text),public.supplier_return_exchanges(uuid,integer),public.guard_supplier_exchange_expense(),public.guard_supplier_exchange_return() from public,anon;
revoke all on function public.guard_supplier_exchange_expense(),public.guard_supplier_exchange_return() from authenticated;
grant execute on function public.link_supplier_exchange(uuid,uuid,uuid,text),public.remove_supplier_exchange(uuid,text),public.supplier_return_exchanges(uuid,integer) to authenticated;
commit;
