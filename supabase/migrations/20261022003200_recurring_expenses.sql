begin;
create table public.recurring_expenses (
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 200),
 category_id uuid not null references public.expense_categories(id),horse_id uuid references public.horses(id),
 vendor text check(length(vendor)<=200),amount_cents integer not null check(amount_cents between 0 and 100000000),
 reimbursable boolean not null default false check(not reimbursable or horse_id is not null),notes text check(length(notes)<=5000),
 cadence text not null check(cadence in ('weekly','monthly','quarterly','yearly')),starts_on date not null,ends_on date check(ends_on>=starts_on),
 active boolean not null default true,next_index integer not null default 0 check(next_index between 0 and 10000),
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.recurring_expense_occurrences (
 id uuid primary key,template_id uuid not null references public.recurring_expenses(id),sequence integer not null,
 expense_date date not null,expense_id uuid unique references public.expenses(id),
 skipped_reason text check(length(trim(skipped_reason)) between 1 and 2000),
 snapshot jsonb not null,created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 unique(template_id,sequence),check((expense_id is null)=(skipped_reason is not null))
);
alter table public.recurring_expenses enable row level security;
alter table public.recurring_expense_occurrences enable row level security;
revoke all on public.recurring_expenses,public.recurring_expense_occurrences from public,anon,authenticated;
grant select on public.recurring_expenses,public.recurring_expense_occurrences to authenticated;
create policy admin_read on public.recurring_expenses for select to authenticated using(public.is_admin());
create policy admin_read on public.recurring_expense_occurrences for select to authenticated using(public.is_admin());
create function public.recurring_expense_date(p_start date,p_cadence text,p_index integer) returns date
language plpgsql immutable set search_path='' as $$
declare month_start date; n integer;
begin
 if p_start is null or p_index is null or p_index not between 0 and 10000 or p_cadence is null or p_cadence not in ('weekly','monthly','quarterly','yearly') then raise exception 'Choose a valid recurring schedule';end if;
 if p_cadence='weekly' then return p_start+7*p_index;end if;
 n:=p_index*case p_cadence when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
 month_start:=(date_trunc('month',p_start)+make_interval(months=>n))::date;
 return month_start+least(extract(day from p_start)::integer,extract(day from month_start+interval '1 month - 1 day')::integer)-1;
end;$$;
revoke all on function public.recurring_expense_date(date,text,integer) from public,anon;
grant execute on function public.recurring_expense_date(date,text,integer) to authenticated;
create function public.save_recurring_expense(p_id uuid,p_revision integer,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.recurring_expenses;old public.recurring_expenses;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_id is null then raise exception 'Reload before saving this schedule';end if;
 v:=jsonb_populate_record(null::public.recurring_expenses,p_data);
 select * into old from public.recurring_expenses where id=p_id for update;
 if found then
  if p_revision is distinct from old.revision then raise exception 'This schedule changed. Reload before saving';end if;
  if old.next_index>0 and row(v.starts_on,v.cadence) is distinct from row(old.starts_on,old.cadence) then raise exception 'Start date and frequency are retained after the first occurrence. Pause this schedule and create a new one';end if;
  update public.recurring_expenses set name=trim(v.name),category_id=v.category_id,horse_id=v.horse_id,vendor=v.vendor,amount_cents=v.amount_cents,reimbursable=coalesce(v.reimbursable,false),notes=v.notes,cadence=v.cadence,starts_on=v.starts_on,ends_on=v.ends_on,active=coalesce(v.active,true),revision=revision+1,updated_at=now() where id=p_id;
 else
  if p_revision<>0 or p_revision is null then raise exception 'Schedule not found';end if;
  insert into public.recurring_expenses(id,name,category_id,horse_id,vendor,amount_cents,reimbursable,notes,cadence,starts_on,ends_on,active)
   values(p_id,trim(v.name),v.category_id,v.horse_id,v.vendor,v.amount_cents,coalesce(v.reimbursable,false),v.notes,v.cadence,v.starts_on,v.ends_on,coalesce(v.active,true));
 end if;
 return p_id;
end;$$;
create function public.prepare_recurring_expense(p_request uuid,p_template uuid,p_revision integer,p_date date,p_skip_reason text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.recurring_expenses;old public.recurring_expense_occurrences;due date;expense uuid;reason text:=nullif(trim(p_skip_reason),'');
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null then raise exception 'Reload before creating a recurring bill';end if;
 if p_skip_reason is not null and reason is null then raise exception 'Enter a reason for skipping';end if;
 select * into s from public.recurring_expenses where id=p_template for update;
 if not found then raise exception 'Schedule not found';end if;
 select * into old from public.recurring_expense_occurrences where id=p_request;
 if found then
  if row(old.template_id,old.expense_date,old.skipped_reason) is distinct from row(p_template,p_date,reason) then raise exception 'This form was already used. Reload before continuing';end if;
  return old.expense_id;
 end if;
 if not s.active then raise exception 'This schedule is paused';end if;
 if s.next_index=10000 then raise exception 'Schedule limit reached. Create a new schedule';end if;
 due:=public.recurring_expense_date(s.starts_on,s.cadence,s.next_index);
 if p_revision is distinct from s.revision or p_date is distinct from due then raise exception 'The next occurrence changed. Reload before continuing';end if;
 if due>(now() at time zone 'America/Chicago')::date or (s.ends_on is not null and due>s.ends_on) then raise exception 'This schedule has no due occurrence';end if;
 if reason is null then
  expense:=public.save_expense(null,jsonb_build_object('expense_date',due,'paid_on',null,'category_id',s.category_id,'horse_id',s.horse_id,'vendor',s.vendor,'amount_cents',s.amount_cents,'reimbursable',s.reimbursable,'notes',s.notes),p_request);
 end if;
 insert into public.recurring_expense_occurrences(id,template_id,sequence,expense_date,expense_id,skipped_reason,snapshot,created_by)
  values(p_request,s.id,s.next_index,due,expense,reason,to_jsonb(s),auth.uid());
 update public.recurring_expenses set next_index=next_index+1,revision=revision+1,updated_at=now() where id=s.id;
 return expense;
end;$$;
create function public.recurring_expense_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by active desc,next_date,name,id) from (
  select s.*,public.recurring_expense_date(starts_on,cadence,next_index) as next_date,c.name as category_name,h.barn_name as horse_name,
  coalesce((select jsonb_agg(to_jsonb(o)) from (select r.id,r.expense_date,r.expense_id,r.skipped_reason,e.paid_on,e.voided_at from public.recurring_expense_occurrences r left join public.expenses e on e.id=r.expense_id where r.template_id=s.id order by r.sequence desc limit 5) o),'[]') as history
  from public.recurring_expenses s join public.expense_categories c on c.id=s.category_id left join public.horses h on h.id=s.horse_id
 ) x),'[]');
end;$$;
revoke all on function public.save_recurring_expense(uuid,integer,jsonb),public.prepare_recurring_expense(uuid,uuid,integer,date,text),public.recurring_expense_overview() from public,anon;
grant execute on function public.save_recurring_expense(uuid,integer,jsonb),public.prepare_recurring_expense(uuid,uuid,integer,date,text),public.recurring_expense_overview() to authenticated;
commit;
