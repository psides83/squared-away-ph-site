begin;
create table public.billing_automation (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 authorized_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(), last_checked_at timestamptz
);
insert into public.billing_automation(singleton) values(true);
create table public.billing_automation_runs (
 id uuid primary key default gen_random_uuid(), business_date date not null unique,
 started_at timestamptz not null default now(), finished_at timestamptz,
 authorized_by uuid references auth.users(id) on delete set null,
 state text not null check(state in ('running','complete','review','error','blocked')),
 results jsonb not null default '[]', reason text
);
alter table public.billing_automation enable row level security;
alter table public.billing_automation_runs enable row level security;
revoke all on public.billing_automation,public.billing_automation_runs from public,anon,authenticated;
grant select on public.billing_automation,public.billing_automation_runs to authenticated;
create policy admin_read on public.billing_automation for select to authenticated using(public.is_admin());
create policy admin_read on public.billing_automation_runs for select to authenticated using(public.is_admin());
create function public.configure_billing_automation(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_enabled is null then raise exception 'Choose whether automatic billing is enabled'; end if;
 update public.billing_automation set enabled=p_enabled,authorized_by=auth.uid(),updated_at=now() where singleton;
end; $$;
revoke all on function public.configure_billing_automation(boolean) from public,anon;
grant execute on function public.configure_billing_automation(boolean) to authenticated;

-- Only a trusted service may enter this worker. The enabling administrator delegates
-- the existing billing operations, with an explicit run audit. Restore both claim
-- formats before returning; never broaden is_admin or any existing public RPC.
create function public.run_scheduled_billing() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.billing_automation; run_id uuid; cycle jsonb; outcome jsonb; run_results jsonb:='[]';
 s record; today date:=(now() at time zone 'America/Chicago')::date;
 old_sub text:=current_setting('request.jwt.claim.sub',true); old_claims text:=current_setting('request.jwt.claims',true);
 problem text; final_state text;
begin
 if not pg_try_advisory_xact_lock(741853106) then return jsonb_build_object('state','busy'); end if;
 select * into cfg from public.billing_automation where singleton for update;
 update public.billing_automation set last_checked_at=now() where singleton;
 if not cfg.enabled then return jsonb_build_object('state','off'); end if;
 if exists(select 1 from public.billing_automation_runs where business_date=today) then return jsonb_build_object('state','already_run'); end if;
 insert into public.billing_automation_runs(business_date,authorized_by,state) values(today,cfg.authorized_by,'running') returning id into run_id;
 if cfg.authorized_by is null or not exists(select 1 from public.admin_users where user_id=cfg.authorized_by) then
  update public.billing_automation_runs set state='blocked',reason='The administrator who enabled billing no longer has administrator access. Re-enable billing as an administrator.',finished_at=now() where id=run_id;
  return jsonb_build_object('state','blocked','run_id',run_id);
 end if;
 begin
  perform set_config('request.jwt.claim.sub',cfg.authorized_by::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',cfg.authorized_by,'role','authenticated')::text,true);
  -- At most one cycle per stay per daily run; old cycles are processed first.
  -- Review drafts are retried so a newly completed calendar/approval can finish.
  for s in select ts.id,n.value from public.training_stays ts
   cross join lateral (select public.next_recurring_cycle(ts.id) as value) n
   where ts.recurring_enabled and n.value->>'state' in ('due','review')
   order by (n.value->>'billing_date')::date,ts.id limit 25
  loop
   begin
    cycle:=s.value;
    outcome:=public.prepare_recurring_invoice(s.id,(cycle->>'from')::date,(cycle->>'to')::date);
    run_results:=run_results||jsonb_build_array(outcome||jsonb_build_object('stay_id',s.id));
   exception when others then
    -- A failed stay rolls back independently; other stays can still be billed.
    run_results:=run_results||jsonb_build_array(jsonb_build_object('stay_id',s.id,'state','error','reason',SQLERRM));
   end;
  end loop;
 exception when others then
  -- Roll back all changes from an unexpected worker failure, retaining the run.
  problem:=SQLERRM;run_results:='[]';
 end;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 final_state:=case when problem is not null or exists(select 1 from jsonb_array_elements(run_results) r where r->>'state'='error') then 'error'
  when exists(select 1 from jsonb_array_elements(run_results) r where r->>'state'='review') then 'review' else 'complete' end;
 update public.billing_automation_runs set state=final_state,results=run_results,reason=problem,finished_at=now() where id=run_id;
 return jsonb_build_object('state',final_state,'run_id',run_id,'processed',jsonb_array_length(run_results));
end; $$;
revoke all on function public.run_scheduled_billing() from public,anon,authenticated;
grant execute on function public.run_scheduled_billing() to service_role;
commit;
