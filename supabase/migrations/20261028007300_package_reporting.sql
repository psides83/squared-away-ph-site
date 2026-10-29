begin;
-- Reporting-only agreement versions. Existing invoices are deliberately not backfilled.
create table public.package_reporting_agreements (
 id uuid primary key, stay_id uuid not null references public.training_stays(id),
 monthly_cents integer not null check(monthly_cents between 1 and 100000000),
 feed_cents integer not null check(feed_cents>=0), board_cents integer not null check(board_cents>=0),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), retired_at timestamptz,
 check(feed_cents::bigint+board_cents<=monthly_cents)
);
create unique index package_reporting_current on public.package_reporting_agreements(stay_id) where retired_at is null;
alter table public.package_reporting_agreements enable row level security;
grant select on public.package_reporting_agreements to authenticated;
create policy admin_read on public.package_reporting_agreements for select to authenticated using((select public.is_admin()));
create function public.set_package_reporting(p_request uuid,p_stay uuid,p_current uuid,p_feed integer,p_board integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.training_stays%rowtype; prior public.package_reporting_agreements%rowtype; current_id uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into s from public.training_stays where id=p_stay for update;
 if not found then raise exception 'Training stay not found'; end if;
 select * into prior from public.package_reporting_agreements where id=p_request;
 if found then
  if prior.stay_id<>p_stay or prior.feed_cents is distinct from p_feed or prior.board_cents is distinct from p_board or prior.reason is distinct from trim(p_reason) then raise exception 'This request was already used with different values'; end if;
  return prior.id;
 end if;
 select id into current_id from public.package_reporting_agreements where stay_id=p_stay and retired_at is null;
 if current_id is distinct from p_current then raise exception 'The reporting agreement changed. Close and reopen this editor'; end if;
 if p_request is null or p_feed is null or p_board is null or p_feed<0 or p_board<0 or p_feed::bigint+p_board>s.monthly_rate_cents or s.monthly_rate_cents<=0 then raise exception 'Feed and board allocations must fit within the positive monthly package rate'; end if;
 if (p_feed>0 and s.feed_billing<>'included') or (p_board>0 and s.boarding_billing<>'included') then raise exception 'Allocate only services included in training'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a private reason'; end if;
 update public.package_reporting_agreements set retired_at=now() where id=current_id;
 insert into public.package_reporting_agreements(id,stay_id,monthly_cents,feed_cents,board_cents,reason,created_by) values(p_request,p_stay,s.monthly_rate_cents,p_feed,p_board,trim(p_reason),auth.uid());
 return p_request;
end; $$;
revoke all on function public.set_package_reporting(uuid,uuid,uuid,integer,integer,text) from public,anon;
grant execute on function public.set_package_reporting(uuid,uuid,uuid,integer,integer,text) to authenticated;

create table public.package_line_reporting (
 line_id uuid primary key references public.invoice_lines(id) on delete cascade,
 agreement_id uuid not null references public.package_reporting_agreements(id),
 feed_cents bigint not null check(feed_cents>=0),board_cents bigint not null check(board_cents>=0),training_cents bigint not null check(training_cents>=0)
);
alter table public.package_line_reporting enable row level security;
grant select on public.package_line_reporting to authenticated;
create policy admin_read on public.package_line_reporting for select to authenticated using((select public.is_admin()));
create function public.capture_package_reporting() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.package_reporting_agreements%rowtype; s public.training_stays%rowtype; feed bigint; board bigint;
begin
 if new.kind<>'training' or new.amount_cents<0 then return new; end if;
 select st.* into s from public.invoices i join public.training_stays st on st.id=i.stay_id where i.id=new.invoice_id;
 if not found then return new; end if;
 select * into a from public.package_reporting_agreements where stay_id=s.id and retired_at is null;
 if not found or a.monthly_cents<>s.monthly_rate_cents or (new.source_snapshot->>'monthly_rate_cents')::integer is distinct from a.monthly_cents or (a.feed_cents>0 and s.feed_billing<>'included') or (a.board_cents>0 and s.boarding_billing<>'included') then return new; end if;
 -- Scale the complete generated training line; allocate remaining pennies to training.
 feed:=floor(new.amount_cents::numeric*a.feed_cents/a.monthly_cents);
 board:=floor(new.amount_cents::numeric*a.board_cents/a.monthly_cents);
 insert into public.package_line_reporting values(new.id,a.id,feed,board,new.amount_cents-feed-board);
 return new;
end; $$;
revoke all on function public.capture_package_reporting() from public,anon,authenticated;
create trigger capture_package_reporting after insert on public.invoice_lines for each row execute function public.capture_package_reporting();

create table public.adjustment_reporting_allocations (
 id uuid primary key, adjustment_id uuid not null references public.invoice_adjustments(id),
 training_cents integer not null check(training_cents>=0),feed_cents integer not null check(feed_cents>=0),
 board_cents integer not null check(board_cents>=0),other_cents integer not null check(other_cents>=0),
 reason text not null check(length(trim(reason)) between 1 and 2000),created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),retired_at timestamptz
);
create unique index adjustment_reporting_current on public.adjustment_reporting_allocations(adjustment_id) where retired_at is null;
alter table public.adjustment_reporting_allocations enable row level security;
grant select on public.adjustment_reporting_allocations to authenticated;
create policy admin_read on public.adjustment_reporting_allocations for select to authenticated using((select public.is_admin()));
create function public.set_adjustment_reporting(p_request uuid,p_adjustment uuid,p_current uuid,p_training integer,p_feed integer,p_board integer,p_other integer,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.invoice_adjustments%rowtype; old public.adjustment_reporting_allocations%rowtype; current_id uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into a from public.invoice_adjustments where id=p_adjustment for update;
 if not found then raise exception 'Invoice adjustment not found'; end if;
 select * into old from public.adjustment_reporting_allocations where id=p_request;
 if found then
  if old.adjustment_id<>p_adjustment or old.training_cents is distinct from p_training or old.feed_cents is distinct from p_feed or old.board_cents is distinct from p_board or old.other_cents is distinct from p_other or old.reason is distinct from trim(p_reason) then raise exception 'This request was already used with different values'; end if;
  return old.id;
 end if;
 select id into current_id from public.adjustment_reporting_allocations where adjustment_id=p_adjustment and retired_at is null;
 if current_id is distinct from p_current then raise exception 'The allocation changed. Close and reopen this editor'; end if;
 if p_request is null or p_training is null or p_feed is null or p_board is null or p_other is null or least(p_training,p_feed,p_board,p_other)<0 or p_training::bigint+p_feed+p_board+p_other<>abs(a.amount_cents::bigint) then raise exception 'Enter nonnegative portions totaling the full adjustment amount'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'Enter a private reason'; end if;
 update public.adjustment_reporting_allocations set retired_at=now() where id=current_id;
 insert into public.adjustment_reporting_allocations(id,adjustment_id,training_cents,feed_cents,board_cents,other_cents,reason,created_by) values(p_request,p_adjustment,p_training,p_feed,p_board,p_other,trim(p_reason),auth.uid());
 return p_request;
end; $$;
revoke all on function public.set_adjustment_reporting(uuid,uuid,uuid,integer,integer,integer,integer,text) from public,anon;
grant execute on function public.set_adjustment_reporting(uuid,uuid,uuid,integer,integer,integer,integer,text) to authenticated;

create function public.package_revenue_report(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Choose a valid date range of at most ten years'; end if;
 with lines as (
 select l.id,l.invoice_id,i.invoice_number,i.issue_date,h.barn_name as horse_name,l.amount_cents,
 p.feed_cents,p.board_cents,p.training_cents,
 exists(select 1 from public.invoice_adjustments a where a.invoice_id=i.id) as has_adjustments
 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id
 left join public.training_stays s on s.id=i.stay_id left join public.horses h on h.id=s.horse_id
 left join public.package_line_reporting p on p.line_id=l.id
 where i.status='issued' and l.kind='training' and i.issue_date between p_from and p_to
 ) select jsonb_build_object('lines',coalesce((select jsonb_agg(to_jsonb(x) order by issue_date,invoice_id,id) from lines x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'invoice_id',a.invoice_id,'invoice_number',i.invoice_number,'amount_cents',a.amount_cents,'adjustment_date',a.adjustment_date,'description',a.description,'allocation',case when r.id is null then null else to_jsonb(r)-'created_by'-'retired_at' end) order by a.adjustment_date,a.id) from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id left join public.adjustment_reporting_allocations r on r.adjustment_id=a.id and r.retired_at is null where i.status='issued' and i.issue_date between p_from and p_to and exists(select 1 from lines l where l.invoice_id=i.id)),'[]'::jsonb),
 'totals',(select jsonb_build_object('feed_cents',coalesce(sum(feed_cents),0),'board_cents',coalesce(sum(board_cents),0),'training_cents',coalesce(sum(training_cents),0),'unallocated_cents',coalesce(sum(amount_cents) filter(where feed_cents is null),0)) from lines)) into result;
 return result;
end; $$;
revoke all on function public.package_revenue_report(date,date) from public,anon;
grant execute on function public.package_revenue_report(date,date) to authenticated;
commit;
