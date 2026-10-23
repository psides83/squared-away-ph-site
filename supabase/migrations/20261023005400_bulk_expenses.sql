begin;
create table public.expense_entry_batches (
 id uuid primary key, payload jsonb not null, expense_ids uuid[] not null,
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
alter table public.expense_entry_batches enable row level security;
revoke all on public.expense_entry_batches from public,anon,authenticated;
grant select on public.expense_entry_batches to authenticated;
create policy admin_read on public.expense_entry_batches for select to authenticated using ((select public.is_admin()));
create function public.record_expense_batch(p_request uuid,p_rows jsonb) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare item jsonb; v public.expenses; ids uuid[] := '{}'; payload jsonb := '[]'; prior public.expense_entry_batches; position integer := 0;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Provide an expense batch';end if;
 if jsonb_array_length(p_rows) not between 1 and 20 then raise exception 'Enter between 1 and 20 expenses';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
 position:=position+1;
 if jsonb_typeof(item)<>'object' then raise exception 'Check expense entry %',position;end if;
 begin v:=jsonb_populate_record(null::public.expenses,item);
 exception when others then raise exception 'Check the dates, IDs and amount for expense entry %',position;end;
 v.vendor:=nullif(trim(v.vendor),'');v.notes:=nullif(trim(v.notes),'');v.reimbursable:=coalesce(v.reimbursable,false);
 if v.id is null or v.id=any(ids) or v.expense_date is null or v.category_id is null or v.amount_cents is null or v.amount_cents not between 0 and 100000000 or length(v.vendor)>200 or length(v.notes)>5000 or (v.reimbursable and v.horse_id is null) then raise exception 'Check the required fields, amount and horse assignment for expense entry %',position;end if;
 ids:=array_append(ids,v.id);
 payload:=payload || jsonb_build_array(jsonb_build_object('id',v.id,'expense_date',v.expense_date,'paid_on',v.paid_on,'category_id',v.category_id,'horse_id',v.horse_id,'vendor',v.vendor,'amount_cents',v.amount_cents,'reimbursable',v.reimbursable,'notes',v.notes));
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.expense_entry_batches where id=p_request;
 if found then
 if prior.payload is distinct from payload then raise exception 'This batch was already saved. Start a new batch for additional expenses';end if;
 return prior.expense_ids; -- Never overwrite later edits or recreate voided/deleted expenses.
 end if;
 position:=0;
 for item in select value from jsonb_array_elements(payload) loop
 position:=position+1;v:=jsonb_populate_record(null::public.expenses,item);
 if not exists(select 1 from public.expense_categories where id=v.category_id) or (v.horse_id is not null and not exists(select 1 from public.horses where id=v.horse_id)) then raise exception 'Choose an existing category and horse for expense entry %',position;end if;
 if exists(select 1 from public.expenses where id=v.id) then raise exception 'Expense entry % was already recorded. Start a new batch',position;end if;
 insert into public.expenses(id,expense_date,paid_on,category_id,horse_id,vendor,amount_cents,reimbursable,notes)
 values(v.id,v.expense_date,v.paid_on,v.category_id,v.horse_id,v.vendor,v.amount_cents,v.reimbursable,v.notes);
 end loop;
 insert into public.expense_entry_batches(id,payload,expense_ids,created_by) values(p_request,payload,ids,auth.uid());
 return ids;
end;$$;
revoke all on function public.record_expense_batch(uuid,jsonb) from public,anon;
grant execute on function public.record_expense_batch(uuid,jsonb) to authenticated;
commit;
