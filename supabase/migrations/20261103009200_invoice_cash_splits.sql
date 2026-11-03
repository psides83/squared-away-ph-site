begin;
create table public.invoice_cash_splits (
 id uuid primary key,invoice_id uuid not null references public.invoices(id),previous_id uuid references public.invoice_cash_splits(id),
 source_token text not null,basis_cents bigint not null check(basis_cents between 1 and 1000000000),submitted_rows jsonb not null,
 reason text not null check(length(trim(reason)) between 1 and 2000),cleared boolean not null default false,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index current_invoice_cash_split on public.invoice_cash_splits(invoice_id) where retired_at is null;
create table public.invoice_cash_split_lines (
 split_id uuid not null references public.invoice_cash_splits(id),position integer not null check(position between 1 and 50),
 horse_id uuid not null references public.horses(id),stay_id uuid references public.training_stays(id),amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 horse_name text not null,stay_label text,primary key(split_id,position)
);
do $$declare t text;begin foreach t in array array['invoice_cash_splits','invoice_cash_split_lines'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy admin_read on public.%I for select to authenticated using((select public.is_admin()))',t);
end loop;end;$$;
create view public.invoice_cash_sources with(security_invoker=true) as
select i.id as invoice_id,i.customer_id,i.total_cents,
 md5(jsonb_build_array(i.id,i.created_at,i.customer_id,i.stay_id,i.total_cents,
 (select jsonb_agg(jsonb_build_array(l.id,l.kind,l.billing_category,l.amount_cents) order by l.id) from public.invoice_lines l where l.invoice_id=i.id),
 (select jsonb_agg(jsonb_build_array(a.id,a.amount_cents) order by a.id) from public.invoice_adjustments a where a.invoice_id=i.id))::text) as source_token
from public.invoice_totals i where i.stay_id is null and i.status in ('draft','issued') and i.total_cents between 1 and 1000000000;
create view public.valid_invoice_cash_splits with(security_invoker=true) as
select a.* from public.invoice_cash_splits a join public.invoice_cash_sources s on s.invoice_id=a.invoice_id and s.source_token=a.source_token and s.total_cents=a.basis_cents
where a.retired_at is null and not a.cleared and exists(select 1 from public.invoice_cash_split_lines l where l.split_id=a.id)
 and not exists(select 1 from public.invoice_cash_split_lines l left join public.training_stays t on t.id=l.stay_id where l.split_id=a.id and l.stay_id is not null and (t.horse_id is distinct from l.horse_id or t.billing_customer_id is distinct from s.customer_id));
grant select on public.invoice_cash_sources,public.valid_invoice_cash_splits to authenticated;
revoke all on public.invoice_cash_sources,public.valid_invoice_cash_splits from public,anon;
create function public.set_invoice_cash_split(p_request uuid,p_invoice uuid,p_current uuid,p_token text,p_rows jsonb,p_reason text,p_clear boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.invoice_cash_splits;cur public.invoice_cash_splits;src public.invoice_cash_sources;item jsonb;h uuid;t uuid;n bigint;total bigint:=0;pos integer:=0;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request is null or p_invoice is null or p_token is null or length(p_token)<>32 or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_clear is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Enter current invoice details, allocation rows and a private reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 perform 1 from public.invoices where id=p_invoice for update;
 if not found then raise exception 'Invoice not found';end if;
 select * into old from public.invoice_cash_splits where id=p_request;
 if found then
  if row(old.invoice_id,old.previous_id,old.source_token,old.submitted_rows,old.reason,old.cleared) is distinct from row(p_invoice,p_current,p_token,p_rows,trim(p_reason),p_clear) then raise exception 'This request was already used with different values';end if;return old.id;
 end if;
 select * into cur from public.invoice_cash_splits where invoice_id=p_invoice and retired_at is null;
 if cur.id is distinct from p_current then raise exception 'The cash split changed. Close and reopen this editor';end if;
 if p_clear then
  if cur.id is null or cur.cleared or p_token<>cur.source_token or p_rows<>'[]'::jsonb then raise exception 'Choose the current saved cash split to clear';end if;
  total:=cur.basis_cents;
 else
  select * into src from public.invoice_cash_sources where invoice_id=p_invoice;
  if not found then raise exception 'Choose a positive draft or finalized invoice without a training stay';end if;
  if src.source_token<>p_token then raise exception 'Invoice charges or customer changed. Close and reopen this editor';end if;
  if jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Enter between one and fifty positive horse/stay amounts';end if;
  -- Lock stays in stable order before rechecking their horse and billing customer.
  if exists(select 1 from jsonb_array_elements(p_rows) x where coalesce(x->>'horse_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(x->>'stay_id','')<>'' and x->>'stay_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or jsonb_typeof(x->'amount_cents') is distinct from 'number' or coalesce(x->>'amount_cents','') !~ '^\d{1,10}$') then raise exception 'Choose valid horses/stays and positive whole-cent amounts';end if;
  perform 1 from public.training_stays s where s.id in(select nullif(x->>'stay_id','')::uuid from jsonb_array_elements(p_rows) x) order by s.id for update;
  for item in select value from jsonb_array_elements(p_rows) loop
   h:=(item->>'horse_id')::uuid;t:=nullif(item->>'stay_id','')::uuid;n:=(item->>'amount_cents')::bigint;
   if n not between 1 and 1000000000 or not exists(select 1 from public.horses where id=h) then raise exception 'Enter a positive amount and an existing horse';end if;
   if t is not null and not exists(select 1 from public.training_stays where id=t and horse_id=h and billing_customer_id=src.customer_id) then raise exception 'Choose a stay for this horse and invoice customer';end if;
   total:=total+n;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_rows) x group by (x->>'horse_id')::uuid,nullif(x->>'stay_id','')::uuid having count(*)>1) then raise exception 'Assign each horse/stay combination once';end if;
  if total>src.total_cents then raise exception 'Assigned amounts cannot exceed the current invoice charges';end if;
  total:=src.total_cents;
 end if;
 update public.invoice_cash_splits set retired_at=now() where id=cur.id;
 insert into public.invoice_cash_splits(id,invoice_id,previous_id,source_token,basis_cents,submitted_rows,reason,cleared,created_by)
 values(p_request,p_invoice,p_current,p_token,total,p_rows,trim(p_reason),p_clear,auth.uid());
 if not p_clear then
  for item in select value from jsonb_array_elements(p_rows) loop
   pos:=pos+1;h:=(item->>'horse_id')::uuid;t:=nullif(item->>'stay_id','')::uuid;
   insert into public.invoice_cash_split_lines(split_id,position,horse_id,stay_id,amount_cents,horse_name,stay_label)
   select p_request,pos,h,t,(item->>'amount_cents')::bigint,barn_name,(select arrival_date::text||' – '||coalesce(departure_date::text,'ongoing') from public.training_stays where id=t) from public.horses where id=h;
  end loop;
 end if;
 return p_request;
end;$$;
revoke all on function public.set_invoice_cash_split(uuid,uuid,uuid,text,jsonb,text,boolean) from public,anon;
grant execute on function public.set_invoice_cash_split(uuid,uuid,uuid,text,jsonb,text,boolean) to authenticated;
-- Preserve the horse identity of stays referenced by private allocation history.
create function public.guard_cash_split_stay_history() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.horse_id<>old.horse_id and exists(select 1 from public.invoice_cash_split_lines where stay_id=old.id) then raise exception 'A stay used in cash split history cannot be reassigned to another horse';end if;return new;end;$$;
revoke all on function public.guard_cash_split_stay_history() from public,anon,authenticated;
create trigger protect_cash_split_stay before update on public.training_stays for each row execute function public.guard_cash_split_stay_history();
create function public.invoice_cash_split_options(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select jsonb_build_object('invoice_id',p_invoice,'source',(select to_jsonb(s) from public.invoice_cash_sources s where invoice_id=p_invoice),
 'current',(select (to_jsonb(a)-'created_by')||jsonb_build_object('valid',exists(select 1 from public.valid_invoice_cash_splits v where v.id=a.id),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by position) from public.invoice_cash_split_lines l where split_id=a.id),'[]'::jsonb)) from public.invoice_cash_splits a where invoice_id=p_invoice and retired_at is null),
 'history',coalesce((select jsonb_agg((to_jsonb(x)-'created_by')||jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(l) order by position) from public.invoice_cash_split_lines l where l.split_id=x.id),'[]'::jsonb))) from(select * from public.invoice_cash_splits where invoice_id=p_invoice order by created_at desc,id limit 10)x),'[]'::jsonb),
 'horses',coalesce((select jsonb_agg(to_jsonb(x) order by barn_name,id) from(select id,barn_name from public.horses order by barn_name,id limit 1000)x),'[]'::jsonb),
 'stays',coalesce((select jsonb_agg(to_jsonb(x) order by arrival_date desc,id) from(select s.id,s.horse_id,s.billing_customer_id,s.arrival_date,s.departure_date from public.training_stays s join public.invoices i on i.id=p_invoice and i.customer_id=s.billing_customer_id order by s.arrival_date desc,s.id limit 2000)x),'[]'::jsonb),
 'options_truncated',(select count(*)>1000 from public.horses) or (select count(*)>2000 from public.training_stays s join public.invoices i on i.id=p_invoice and i.customer_id=s.billing_customer_id)) into result;return result;
end;$$;
revoke all on function public.invoice_cash_split_options(uuid) from public,anon;
grant execute on function public.invoice_cash_split_options(uuid) to authenticated;

create or replace view public.reporting_receipts with(security_invoker=true) as
with raw as (
select 'payment'::text as event_kind,p.id as payment_id,p.invoice_id,p.paid_on,p.amount_cents,coalesce(s.horse_id,l.horse_id) as horse_id,coalesce(i.stay_id,l.stay_id) as stay_id
from public.invoice_payments p join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and p.reversed_at is null
union all
select 'refund',r.id,r.invoice_id,r.refunded_on,-r.amount_cents,coalesce(s.horse_id,l.horse_id),coalesce(i.stay_id,l.stay_id)
from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null where i.status='issued' and r.reversed_at is null
union all select 'advance',id,null::uuid,credit_on,amount_cents,null::uuid,null::uuid from public.customer_credits where source='advance' and reversed_at is null
union all select 'credit_refund',r.id,p.invoice_id,r.refunded_on,-r.amount_cents,coalesce(s.horse_id,l.horse_id),coalesce(i.stay_id,l.stay_id)
from public.customer_credit_refunds r join public.customer_credits c on c.id=r.credit_id left join public.invoice_payments p on p.id=c.payment_id left join public.invoices i on i.id=p.invoice_id left join public.training_stays s on s.id=i.stay_id left join public.invoice_reporting_links l on l.invoice_id=i.id and l.retired_at is null
where r.reversed_at is null
), portions as (
 select r.*,x.horse_id as target_horse,x.stay_id as target_stay,x.position,x.portion,x.basis
 from raw r left join public.invoice_cash_splits a on a.invoice_id=r.invoice_id and a.retired_at is null
 left join public.valid_invoice_cash_splits v on v.id=a.id
 cross join lateral (
  select r.horse_id,r.stay_id,1 as position,1::numeric as portion,1::numeric as basis where a.id is null or a.cleared
  union all select null::uuid,null::uuid,1,1,1 where a.id is not null and not a.cleared and v.id is null
  union all select l.horse_id,l.stay_id,l.position,l.amount_cents::numeric,v.basis_cents::numeric from public.invoice_cash_split_lines l where l.split_id=v.id
  union all select null::uuid,null::uuid,51,v.basis_cents-coalesce((select sum(amount_cents) from public.invoice_cash_split_lines where split_id=v.id),0),v.basis_cents where v.id is not null
 ) x where x.portion>0
), shares as (
 select *,floor(abs(amount_cents::numeric)*portion/basis) as whole,abs(amount_cents::numeric)*portion/basis-floor(abs(amount_cents::numeric)*portion/basis) as remainder from portions
), amounts as (
 select *,sign(amount_cents::numeric)*(whole+case when row_number() over(partition by event_kind,payment_id order by remainder desc,position)<=abs(amount_cents::numeric)-sum(whole) over(partition by event_kind,payment_id) then 1 else 0 end) as allocated from shares
)
select payment_id,invoice_id,paid_on,allocated::integer as amount_cents,target_horse as horse_id,target_stay as stay_id from amounts where allocated<>0;
commit;
