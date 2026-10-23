begin;
create table public.expense_automation (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 authorized_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now(),last_checked_at timestamptz
);
insert into public.expense_automation(singleton) values(true);
create table public.expense_automation_runs (
 id uuid primary key default gen_random_uuid(),business_date date not null unique,
 started_at timestamptz not null default now(),finished_at timestamptz,
 authorized_by uuid references auth.users(id) on delete set null,
 state text not null check(state in ('running','complete','error','blocked')),results jsonb not null default '[]',reason text
);
alter table public.expense_automation enable row level security;
alter table public.expense_automation_runs enable row level security;
revoke all on public.expense_automation,public.expense_automation_runs from public,anon,authenticated;
grant select on public.expense_automation,public.expense_automation_runs to authenticated;
create policy admin_read on public.expense_automation for select to authenticated using(public.is_admin());
create policy admin_read on public.expense_automation_runs for select to authenticated using(public.is_admin());
create function public.configure_expense_automation(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_enabled is null then raise exception 'Choose whether automatic expense creation is enabled';end if;
 update public.expense_automation set enabled=p_enabled,authorized_by=auth.uid(),updated_at=now() where singleton;
end;$$;
revoke all on function public.configure_expense_automation(boolean) from public,anon;
grant execute on function public.configure_expense_automation(boolean) to authenticated;
create function public.run_scheduled_expenses() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.expense_automation;run_id uuid;today date:=(now() at time zone 'America/Chicago')::date;
 s record;expense uuid;outcomes jsonb:='[]';problem text;final_state text;
 old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);
begin
 if not pg_try_advisory_xact_lock(741853107) then return jsonb_build_object('state','busy');end if;
 select * into cfg from public.expense_automation where singleton for update;
 update public.expense_automation set last_checked_at=now() where singleton;
 if not cfg.enabled then return jsonb_build_object('state','off');end if;
 if exists(select 1 from public.expense_automation_runs where business_date=today) then return jsonb_build_object('state','already_run');end if;
 insert into public.expense_automation_runs(business_date,authorized_by,state) values(today,cfg.authorized_by,'running') returning id into run_id;
 if cfg.authorized_by is null or not exists(select 1 from public.admin_users where user_id=cfg.authorized_by) then
  update public.expense_automation_runs set state='blocked',reason='The enabling administrator no longer has administrator access. Re-enable automatic expenses as an administrator.',finished_at=now() where id=run_id;
  return jsonb_build_object('state','blocked','run_id',run_id);
 end if;
 begin
  perform set_config('request.jwt.claim.sub',cfg.authorized_by::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',cfg.authorized_by,'role','authenticated')::text,true);
  for s in select r.*,public.recurring_expense_date(r.starts_on,r.cadence,r.next_index) as due
   from public.recurring_expenses r where active and next_index<10000
    and public.recurring_expense_date(r.starts_on,r.cadence,r.next_index)<=today
    and (ends_on is null or public.recurring_expense_date(r.starts_on,r.cadence,r.next_index)<=ends_on)
   order by public.recurring_expense_date(r.starts_on,r.cadence,r.next_index),r.id limit 50
  loop
   begin
    expense:=public.prepare_recurring_expense(gen_random_uuid(),s.id,s.revision,s.due,null);
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('template_id',s.id,'name',s.name,'expense_id',expense,'expense_date',s.due,'state','created'));
   exception when others then
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('template_id',s.id,'name',s.name,'state','error','reason',SQLERRM));
   end;
  end loop;
 exception when others then problem:=SQLERRM;outcomes:='[]';end;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 final_state:=case when problem is not null or exists(select 1 from jsonb_array_elements(outcomes) r where r->>'state'='error') then 'error' else 'complete' end;
 update public.expense_automation_runs set state=final_state,results=outcomes,reason=problem,finished_at=now() where id=run_id;
 return jsonb_build_object('state',final_state,'run_id',run_id,'processed',jsonb_array_length(outcomes));
end;$$;
revoke all on function public.run_scheduled_expenses() from public,anon,authenticated;
grant execute on function public.run_scheduled_expenses() to service_role;
-- One provider invocation; independent settings, audits and rollback boundaries.
create function public.run_scheduled_automations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare billing jsonb;expenses jsonb;state text;
begin
 begin billing:=public.run_scheduled_billing();exception when others then billing:=jsonb_build_object('state','error');end;
 begin expenses:=public.run_scheduled_expenses();exception when others then expenses:=jsonb_build_object('state','error');end;
 state:=case when billing->>'state' in ('error','blocked') or expenses->>'state' in ('error','blocked') then 'error'
  when billing->>'state'='review' then 'review' else 'complete' end;
 return jsonb_build_object('state',state,'processed',coalesce((billing->>'processed')::integer,0)+coalesce((expenses->>'processed')::integer,0),'billing',billing,'expenses',expenses);
end;$$;
revoke all on function public.run_scheduled_automations() from public,anon,authenticated;
grant execute on function public.run_scheduled_automations() to service_role;
commit;
