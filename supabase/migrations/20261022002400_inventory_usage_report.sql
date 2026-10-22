-- Operational usage follows ledger dates and retained weighted costs, not cash payments.
create function public.inventory_usage_report(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of at most ten years'; end if;
 with usage as (
  select m.product_id,m.horse_id,coalesce(original.kind,m.kind) as usage_kind,
    -m.quantity_delta_oz as quantity_oz,-m.value_delta_cents as cost_cents,m.kind='reversal' as correction
  from public.inventory_movements m
  left join public.inventory_movements original on original.id=m.reverses_id
  where m.movement_date between p_from and p_to and
    (m.kind in ('feeding','waste','adjustment_out') or (m.kind='reversal' and original.kind in ('feeding','waste','adjustment_out')))
 ), totals as (
  select coalesce(sum(cost_cents) filter(where usage_kind='feeding'),0) feed_cents,
    coalesce(sum(cost_cents) filter(where usage_kind='waste'),0) waste_cents,
    coalesce(sum(cost_cents) filter(where usage_kind='adjustment_out'),0) adjustment_cents,
    coalesce(-sum(cost_cents) filter(where correction),0) correction_cents from usage
 ), products as (
  select p.id,p.name,p.category,
    coalesce(sum(u.quantity_oz) filter(where usage_kind='feeding'),0) feed_oz,
    coalesce(sum(u.cost_cents) filter(where usage_kind='feeding'),0) feed_cents,
    coalesce(sum(u.quantity_oz) filter(where usage_kind='waste'),0) waste_oz,
    coalesce(sum(u.cost_cents) filter(where usage_kind='waste'),0) waste_cents,
    coalesce(sum(u.cost_cents) filter(where usage_kind='adjustment_out'),0) adjustment_cents,
    coalesce(-sum(u.cost_cents) filter(where correction),0) correction_cents
  from usage u join public.inventory_products p on p.id=u.product_id group by p.id,p.name,p.category
 ), horses as (
  select u.horse_id,coalesce(h.barn_name,'Unassigned horse') name,
    sum(u.cost_cents) feed_cents,
    count(*) filter(where not correction) feeding_lines,
    count(*) filter(where correction) corrected_lines
  from usage u left join public.horses h on h.id=u.horse_id where u.usage_kind='feeding' group by u.horse_id,h.barn_name
 ) select jsonb_build_object('totals',(select to_jsonb(t) from totals t),
   'products',coalesce((select jsonb_agg(p order by p.name,p.id) from products p),'[]'::jsonb),
   'horses',coalesce((select jsonb_agg(h order by h.name,h.horse_id) from horses h),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.inventory_usage_report(date,date) from public,anon;
grant execute on function public.inventory_usage_report(date,date) to authenticated;
