begin;
-- Operational scheduler logs only; financial records and source audits are never pruned.
create function public.prune_automation_runs() returns jsonb
language plpgsql security definer set search_path='' as $$
declare billing_count integer;expense_count integer;
begin
 if not pg_try_advisory_xact_lock(741853108) then return jsonb_build_object('state','busy');end if;
 delete from public.billing_automation_runs where id in (
  select id from public.billing_automation_runs
  where finished_at is not null and state<>'running'
   and finished_at < now()-case when state='complete' then interval '90 days' else interval '365 days' end
   and business_date < (now() at time zone 'America/Chicago')::date
   and id <> (select id from public.billing_automation_runs order by business_date desc limit 1)
  order by finished_at,id limit 500
 );
 get diagnostics billing_count = row_count;
 delete from public.expense_automation_runs where id in (
  select id from public.expense_automation_runs
  where finished_at is not null and state<>'running'
   and finished_at < now()-case when state='complete' then interval '90 days' else interval '365 days' end
   and business_date < (now() at time zone 'America/Chicago')::date
   and id <> (select id from public.expense_automation_runs order by business_date desc limit 1)
  order by finished_at,id limit 500
 );
 get diagnostics expense_count = row_count;
 return jsonb_build_object('state','complete','billing_deleted',billing_count,'expenses_deleted',expense_count);
end;$$;
revoke all on function public.prune_automation_runs() from public,anon,authenticated;
grant execute on function public.prune_automation_runs() to service_role;
create or replace function public.run_scheduled_automations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare billing jsonb;expenses jsonb;state text;cleanup jsonb;
begin
 begin billing:=public.run_scheduled_billing();exception when others then billing:=jsonb_build_object('state','error');end;
 begin expenses:=public.run_scheduled_expenses();exception when others then expenses:=jsonb_build_object('state','error');end;
 begin cleanup:=public.prune_automation_runs();exception when others then cleanup:=jsonb_build_object('state','error');end;
 state:=case when billing->>'state' in ('error','blocked') or expenses->>'state' in ('error','blocked') then 'error'
  when cleanup->>'state'='error' then 'error'
  when billing->>'state'='review' then 'review' else 'complete' end;
 return jsonb_build_object('state',state,'processed',coalesce((billing->>'processed')::integer,0)+coalesce((expenses->>'processed')::integer,0),'billing',billing,'expenses',expenses,'cleanup',cleanup);
end;$$;
commit;
