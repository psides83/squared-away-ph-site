begin;

-- Revisions retain the exact days and cents approved by the administrator.
create table public.expense_allocations (
  id uuid primary key, expense_id uuid not null references public.expenses(id),
  period_from date not null, period_to date not null,
  check(period_to>=period_from and period_to-period_from<=365),
  source_amount_cents integer not null check(source_amount_cents>=0),
  reason text not null check(length(trim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(), created_by uuid not null references auth.users(id),
  retired_at timestamptz, retired_reason text,
  submitted_rows jsonb not null
);
create unique index one_active_expense_allocation on public.expense_allocations(expense_id) where retired_at is null;
create table public.expense_allocation_lines (
  allocation_id uuid not null references public.expense_allocations(id),
  horse_id uuid not null references public.horses(id), horse_name text not null,
  board_days integer not null check(board_days between 1 and 366),
  training_days_snapshot integer not null check(training_days_snapshot between 0 and 366),
  amount_cents integer not null check(amount_cents>=0),
  primary key(allocation_id,horse_id)
);
create index allocation_lines_horse on public.expense_allocation_lines(horse_id);
alter table public.expense_allocations enable row level security;
alter table public.expense_allocation_lines enable row level security;
revoke all on public.expense_allocations,public.expense_allocation_lines from anon,authenticated;
grant select on public.expense_allocations,public.expense_allocation_lines to authenticated;
create policy allocations_admin on public.expense_allocations for select to authenticated using(public.is_admin());
create policy allocation_lines_admin on public.expense_allocation_lines for select to authenticated using(public.is_admin());

create function public.allocation_board_days(p_from date,p_to date) returns table(horse_id uuid,horse_name text,board_days integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 or p_to>(now() at time zone 'America/Chicago')::date then
    raise exception 'Choose an elapsed allocation period of at most 366 days'; end if;
  return query select h.id,h.barn_name,coalesce(sum(least(coalesce(s.departure_date,p_to),p_to)-greatest(s.arrival_date,p_from)+1) filter(where s.id is not null),0)::integer
    from public.horses h left join public.training_stays s on s.horse_id=h.id and s.arrival_date<=p_to and (s.departure_date is null or s.departure_date>=p_from)
    group by h.id,h.barn_name order by h.barn_name,h.id;
end $$;

create function public.save_expense_allocation(p_request uuid,p_expense uuid,p_from date,p_to date,p_rows jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.expenses; existing public.expense_allocations; total_days bigint; n integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_request is null or p_expense is null or p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter an allocation reason'; end if;
  select * into e from public.expenses where id=p_expense for update;
  if not found then raise exception 'Expense not found'; end if;
  select * into existing from public.expense_allocations where id=p_request;
  if found then
    if row(existing.expense_id,existing.period_from,existing.period_to,existing.submitted_rows,existing.reason)
      is distinct from row(p_expense,p_from,p_to,p_rows,trim(p_reason)) then raise exception 'This allocation form was already used. Reload before saving another revision.'; end if;
    return existing.id;
  end if;
  if e.voided_at is not null or e.horse_id is not null then raise exception 'Allocate only non-voided shared barn expenses'; end if;
  -- Validate the period and get authoritative default counts, including zero-day horses.
  perform * from public.allocation_board_days(p_from,p_to);
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Choose at least one horse with boarding days'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object' or coalesce(r->>'horse_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(r->>'board_days','') !~ '^[0-9]{1,3}$') then raise exception 'Invalid horse or boarding days'; end if;
  select count(*),sum((r->>'board_days')::integer) into n,total_days from jsonb_array_elements(p_rows) r;
  if (select count(distinct r->>'horse_id') from jsonb_array_elements(p_rows) r)<>n then raise exception 'Each horse must appear once'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'board_days')::integer not between 1 and (p_to-p_from+1)
    or not exists(select 1 from public.horses h where h.id=(r->>'horse_id')::uuid)) then raise exception 'Boarding days must fit the period and reference an existing horse'; end if;
  update public.expense_allocations set retired_at=now(),retired_reason='Replaced: '||trim(p_reason) where expense_id=e.id and retired_at is null;
  insert into public.expense_allocations(id,expense_id,period_from,period_to,source_amount_cents,reason,created_by,submitted_rows)
    values(p_request,e.id,p_from,p_to,e.amount_cents,trim(p_reason),auth.uid(),p_rows);
  -- Largest remainder, with stable UUID ties, allocates every penny exactly once.
  insert into public.expense_allocation_lines(allocation_id,horse_id,horse_name,board_days,training_days_snapshot,amount_cents)
  with basis as (
    select d.horse_id,d.horse_name,d.board_days as training_days,(r->>'board_days')::integer as days,
      e.amount_cents::bigint*(r->>'board_days')::integer as numerator
    from jsonb_array_elements(p_rows) r join public.allocation_board_days(p_from,p_to) d on d.horse_id=(r->>'horse_id')::uuid
  ), ranked as (
    select *,numerator/total_days as base,row_number() over(order by numerator%total_days desc,horse_id) as rank,
      sum(numerator/total_days) over() as base_total from basis
  ) select p_request,horse_id,horse_name,days,training_days,(base+case when rank<=e.amount_cents-base_total then 1 else 0 end)::integer from ranked;
  if (select coalesce(sum(amount_cents),0) from public.expense_allocation_lines where allocation_id=p_request)<>e.amount_cents then raise exception 'Allocation does not reconcile'; end if;
  return p_request;
end $$;

create function public.clear_expense_allocation(p_expense uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a reason for clearing the allocation'; end if;
  perform 1 from public.expenses where id=p_expense for update;
  if not found then raise exception 'Expense not found'; end if;
  update public.expense_allocations set retired_at=now(),retired_reason=trim(p_reason) where expense_id=p_expense and retired_at is null;
end $$;

create function public.guard_allocated_expense() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(old.amount_cents,old.horse_id,old.expense_date,old.voided_at) is distinct from row(new.amount_cents,new.horse_id,new.expense_date,new.voided_at)
    and exists(select 1 from public.expense_allocations where expense_id=old.id and retired_at is null) then
    raise exception 'Clear the shared-cost allocation before changing its amount, assignment, expense date, or void status';
  end if;
  return new;
end $$;
create trigger protect_allocated_expense before update on public.expenses for each row execute function public.guard_allocated_expense();

create function public.horse_cash_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid reporting period of at most ten years'; end if;
  with received as (
    select s.horse_id,sum(p.amount_cents)::bigint as amount from public.invoice_payments p
    join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id
    where i.status='issued' and p.reversed_at is null and p.paid_on between p_from and p_to group by s.horse_id
  ), direct as (
    select horse_id,sum(amount_cents)::bigint as amount from public.expenses where voided_at is null and paid_on between p_from and p_to and horse_id is not null group by horse_id
  ), shared as (
    select l.horse_id,sum(l.amount_cents)::bigint as amount from public.expenses e
    join public.expense_allocations a on a.expense_id=e.id and a.retired_at is null join public.expense_allocation_lines l on l.allocation_id=a.id
    where e.voided_at is null and e.horse_id is null and e.paid_on between p_from and p_to group by l.horse_id
  ), rows as (
    select h.id as horse_id,h.barn_name as horse_name,coalesce(r.amount,0) as received_cents,coalesce(d.amount,0) as direct_cents,coalesce(s.amount,0) as shared_cents,
      coalesce(r.amount,0)-coalesce(d.amount,0)-coalesce(s.amount,0) as margin_cents
    from public.horses h left join received r on r.horse_id=h.id left join direct d on d.horse_id=h.id left join shared s on s.horse_id=h.id
  ) select jsonb_build_object('horses',coalesce((select jsonb_agg(rows order by horse_name,horse_id) from rows),'[]'),
    'unassigned_received_cents',coalesce((select amount from received where horse_id is null),0),
    'unallocated_paid_cents',coalesce((select sum(e.amount_cents) from public.expenses e where e.voided_at is null and e.horse_id is null and e.paid_on between p_from and p_to
      and not exists(select 1 from public.expense_allocations a where a.expense_id=e.id and a.retired_at is null)),0)) into result;
  return result;
end $$;
-- A stay-linked invoice's horse attribution must survive later stay edits.
create function public.guard_invoice_stay_horse() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.horse_id<>old.horse_id and exists(select 1 from public.invoices where stay_id=old.id) then raise exception 'A stay linked to an invoice cannot be reassigned to another horse'; end if;
  return new;
end $$;
create trigger protect_invoice_stay_horse before update on public.training_stays for each row execute function public.guard_invoice_stay_horse();
revoke all on function public.allocation_board_days(date,date),public.save_expense_allocation(uuid,uuid,date,date,jsonb,text),public.clear_expense_allocation(uuid,text),public.horse_cash_report(date,date),public.guard_allocated_expense(),public.guard_invoice_stay_horse() from public;
grant execute on function public.allocation_board_days(date,date),public.save_expense_allocation(uuid,uuid,date,date,jsonb,text),public.clear_expense_allocation(uuid,text),public.horse_cash_report(date,date) to authenticated;
commit;
