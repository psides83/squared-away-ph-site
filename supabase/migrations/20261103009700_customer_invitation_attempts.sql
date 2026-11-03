begin;
create table public.customer_invitation_attempts (
 id uuid primary key,customer_id uuid not null references public.customers(id),email text not null,
 actor uuid not null references auth.users(id),created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','accepted','review')),
 completed_at timestamptz,
 check((state='pending' and completed_at is null) or (state<>'pending' and completed_at is not null))
);
create index customer_invitation_history on public.customer_invitation_attempts(customer_id,created_at desc,id);
alter table public.customer_invitation_attempts enable row level security;
revoke all on public.customer_invitation_attempts from public,anon,authenticated;
grant select on public.customer_invitation_attempts to authenticated;
create policy admin_read on public.customer_invitation_attempts for select to authenticated using(public.is_admin());
create function public.begin_customer_invitation(p_id uuid,p_customer uuid,p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.customers;old public.customer_invitation_attempts;target_email text;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_id is null or p_customer is null or p_email is null then raise exception 'Choose a customer and saved email';end if;
 -- Serialize all reservations, including request ID and normalized email collisions.
 perform pg_advisory_xact_lock(hashtextextended('customer_invitation_reservations',0));
 select * into old from public.customer_invitation_attempts where id=p_id;
 if found then
  if row(old.customer_id,old.email,old.actor) is distinct from row(p_customer,lower(trim(p_email)),auth.uid()) then raise exception 'This request was already used with different details';end if;
  return jsonb_build_object('send',false,'email',old.email,'state',old.state);
 end if;
 select * into c from public.customers where id=p_customer for update;
 if not found then raise exception 'Customer not found';end if;
 target_email:=lower(trim(c.email));
 if target_email is null or length(target_email)>254 or target_email!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or target_email<>lower(trim(p_email)) then raise exception 'The customer email changed or is invalid. Refresh and review the customer record';end if;
 if exists(select 1 from public.customer_portal_accounts where customer_id=p_customer) or exists(select 1 from auth.users where lower(auth.users.email)=target_email) then raise exception 'An account already exists. Link or recover that account instead of sending a new invitation';end if;
 if exists(select 1 from public.customer_invitation_attempts a where a.email=target_email and a.state in ('pending','review')) then raise exception 'An earlier attempt needs provider review before another invitation can be sent';end if;
 if exists(select 1 from public.customer_invitation_attempts a where a.email=target_email and a.created_at>now()-interval '10 minutes') or (select count(*) from public.customer_invitation_attempts where created_at>now()-interval '24 hours')>=20 then raise exception 'Invitation limit reached. Try again later';end if;
 insert into public.customer_invitation_attempts(id,customer_id,email,actor) values(p_id,p_customer,target_email,auth.uid());
 return jsonb_build_object('send',true,'email',target_email,'state','pending');
end;$$;
create function public.finish_customer_invitation(p_id uuid,p_accepted boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_accepted is null then raise exception 'Choose a provider result';end if;
 update public.customer_invitation_attempts set state=case when p_accepted then 'accepted' else 'review' end,completed_at=now() where id=p_id and state='pending';
end;$$;
revoke all on function public.begin_customer_invitation(uuid,uuid,text) from public,anon;
grant execute on function public.begin_customer_invitation(uuid,uuid,text) to authenticated;
revoke all on function public.finish_customer_invitation(uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_customer_invitation(uuid,boolean) to service_role;
commit;
