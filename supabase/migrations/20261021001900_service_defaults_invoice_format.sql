alter table public.business_settings
  add column default_feed_monthly_cents integer check(default_feed_monthly_cents between 0 and 100000000),
  add column default_boarding_monthly_cents integer check(default_boarding_monthly_cents between 0 and 100000000);
alter table public.customers add column invoice_presentation text not null default 'itemized'
  check(invoice_presentation in ('itemized','combined_services'));
alter table public.invoice_lines add column billing_category text not null default 'other'
  check(billing_category in ('other','training','feed','boarding'));
update public.invoice_lines set billing_category=case when kind='training' then 'training' when kind='service' and source_snapshot->>'service' in ('feed','boarding') then source_snapshot->>'service' else 'other' end;
create function public.set_invoice_billing_category() returns trigger language plpgsql set search_path='' as $$ begin
  if new.kind='training' then new.billing_category:='training';
  elsif new.kind='service' and new.source_snapshot->>'service' in ('feed','boarding') then new.billing_category:=new.source_snapshot->>'service'; end if;
  return new;
end; $$;
create trigger set_invoice_billing_category before insert on public.invoice_lines for each row execute function public.set_invoice_billing_category();

drop function public.add_invoice_line(uuid,uuid,text,integer);
create function public.add_invoice_line(p_request uuid,p_invoice uuid,p_description text,p_amount integer,p_category text default 'other') returns uuid
language plpgsql security definer set search_path='' as $$ declare existing public.invoice_lines%rowtype; begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_category is null or p_category not in ('other','training','feed','boarding') then raise exception 'Choose a valid charge category'; end if;
  perform 1 from public.invoices where id=p_invoice and status='draft' for update;
  if not found then raise exception 'Only a draft can receive line items'; end if;
  insert into public.invoice_lines(id,invoice_id,description,amount_cents,kind,billing_category) values(p_request,p_invoice,p_description,p_amount,'manual',p_category) on conflict(id) do nothing;
  select * into existing from public.invoice_lines where id=p_request;
  if row(existing.invoice_id,existing.description,existing.amount_cents,existing.kind,existing.billing_category) is distinct from row(p_invoice,p_description,p_amount,'manual'::text,p_category) then raise exception 'This form was already used. Reload for another line.'; end if;
  return p_request;
end; $$;

revoke all on function public.add_invoice_line(uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.add_invoice_line(uuid,uuid,text,integer,text) to authenticated;

create or replace function public.finalize_invoice(p_invoice uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; customer public.customers%rowtype; settings public.business_settings%rowtype; total bigint; number bigint;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status='issued' then return inv.invoice_number; end if;
  if inv.status<>'draft' then raise exception 'Voided invoices cannot be finalized'; end if;
  if inv.issue_date>(now() at time zone 'America/Chicago')::date then raise exception 'Cannot issue a future-dated invoice'; end if;
  if not exists(select 1 from public.invoice_lines where invoice_id=p_invoice) then raise exception 'Add at least one line before finalizing'; end if;
  select sum(amount_cents) into total from public.invoice_lines where invoice_id=p_invoice;
  if total<0 or total>1000000000 then raise exception 'Invoice total must be between zero and $10,000,000'; end if;
  select * into customer from public.customers where id=inv.customer_id for share;
  select * into settings from public.business_settings where singleton for share;
  if not found then raise exception 'Business settings are missing'; end if;
  number:=nextval('public.invoice_number_seq');
  update public.invoices set status='issued',invoice_number=number,issued_total_cents=total,issued_at=now(),
    customer_snapshot=jsonb_build_object('name',customer.name,'email',customer.email,'phone',customer.phone,'invoice_presentation',customer.invoice_presentation),
    business_snapshot=jsonb_build_object('name','Squared Away Performance Horses','phone',settings.business_phone,'email',settings.business_email,'payment_instructions',settings.payment_instructions,'venmo_url',settings.venmo_url,'paypal_url',settings.paypal_url,'apple_cash_instructions',settings.apple_cash_instructions)
    where id=p_invoice;
  return number;
end; $$;

-- Presentation changes only: source charges, reservations, costs and totals stay intact.
-- This helper is private; customer callers reach it only after portal ownership checks.
create function public.invoice_display_lines(p_invoice uuid,p_combine boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  with lines as (
    select id::text,description,amount_cents::bigint,created_at,billing_category in ('training','feed','boarding') as bundle
    from public.invoice_lines where invoice_id=p_invoice
  ), displayed as (
    select id,description,amount_cents,created_at from lines where not(p_combine and bundle)
    union all
    select 'combined-services','Training, feed & board',sum(amount_cents)::bigint,min(created_at)
    from lines where p_combine and bundle having count(*)>0
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description,'amount_cents',amount_cents) order by created_at,id),'[]'::jsonb) from displayed;
$$;
revoke all on function public.invoice_display_lines(uuid,boolean) from public,anon,authenticated;
create function public.admin_invoice_presentation(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare inv public.invoices%rowtype; style text;
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.status='draft' then select invoice_presentation into style from public.customers where id=inv.customer_id;
  else style:=coalesce(inv.customer_snapshot->>'invoice_presentation','itemized'); end if;
  return jsonb_build_object('style',style,'lines',public.invoice_display_lines(p_invoice,style='combined_services'));
end; $$;
revoke all on function public.admin_invoice_presentation(uuid) from public,anon;
grant execute on function public.admin_invoice_presentation(uuid) to authenticated;

create or replace function public.portal_invoice(p_invoice uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer uuid:=public.current_customer_id();i public.invoice_totals;result jsonb;
begin
  if customer is null then raise exception 'Customer portal access required'; end if;
  select * into i from public.invoice_totals where id=p_invoice and customer_id=customer and status in ('issued','void');
  if not found then return null; end if;
  result:=jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'issue_date',i.issue_date,'due_date',i.due_date,'period_from',i.period_from,'period_to',i.period_to,'status',i.status,
    'customer',i.customer_snapshot,'business',i.business_snapshot,'notes',i.notes,'base_cents',i.base_cents,'adjustment_cents',i.adjustment_cents,'total_cents',i.total_cents,'paid_cents',i.paid_cents,'balance_cents',i.balance_cents,
    'lines',public.invoice_display_lines(i.id,coalesce(i.customer_snapshot->>'invoice_presentation','itemized')='combined_services'),
    'payments',coalesce((select jsonb_agg(x order by paid_on,id) from (select id,paid_on,amount_cents,method,(reversed_at is not null) as reversed from public.invoice_payments where invoice_id=i.id) x),'[]'),
    'adjustments',coalesce((select jsonb_agg(x order by adjustment_date,id) from (select id,adjustment_date,description,amount_cents from public.invoice_adjustments where invoice_id=i.id) x),'[]'));
  return result;
end $$;
