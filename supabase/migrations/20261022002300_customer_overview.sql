create function public.customer_overview() returns table(
 customer_id uuid,horse_count bigint,current_stays bigint,outstanding_cents bigint,overdue_cents bigint,
 outstanding_count bigint,draft_count bigint,last_payment_date date,last_payment_cents integer,portal_status text
) language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 return query select c.id,
  (select count(*) from public.horse_customers hc where hc.customer_id=c.id),
  (select count(*) from public.training_stays s where s.billing_customer_id=c.id and s.arrival_date <= (now() at time zone 'America/Chicago')::date and (s.departure_date is null or s.departure_date >= (now() at time zone 'America/Chicago')::date)),
  coalesce(b.outstanding,0)::bigint,coalesce(b.overdue,0)::bigint,coalesce(b.open_count,0),coalesce(b.drafts,0),p.paid_on,p.amount_cents,
  case when a.customer_id is null then 'Not linked' when a.active then 'Active' else 'Disabled' end
 from public.customers c
 left join lateral (
  select sum(i.balance_cents) filter(where i.status='issued' and i.balance_cents>0) outstanding,
   sum(i.balance_cents) filter(where i.status='issued' and i.balance_cents>0 and i.due_date < (now() at time zone 'America/Chicago')::date) overdue,
   count(*) filter(where i.status='issued' and i.balance_cents>0) open_count,
   count(*) filter(where i.status='draft') drafts
  from public.invoice_totals i where i.customer_id=c.id
 ) b on true
 left join lateral (
  select ip.paid_on,ip.amount_cents from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id
  where i.customer_id=c.id and i.status='issued' and ip.reversed_at is null
  order by ip.paid_on desc,ip.created_at desc,ip.id limit 1
 ) p on true
 left join public.customer_portal_accounts a on a.customer_id=c.id
 order by c.name,c.id;
end; $$;
revoke all on function public.customer_overview() from public,anon;
grant execute on function public.customer_overview() to authenticated;
