-- Retain request snapshots so retries cannot duplicate sessions or overwrite edited logs.
create table public.training_log_batches (
 id uuid primary key, payload jsonb not null,
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid() references auth.users(id)
);
alter table public.training_log_batches enable row level security;
revoke all on public.training_log_batches from anon,authenticated;
grant select on public.training_log_batches to authenticated;
create policy admin_only on public.training_log_batches for select to authenticated using ((select public.is_admin()));
alter table public.training_log_batches add column completed_at timestamptz;
alter table public.training_entries add column batch_id uuid references public.training_log_batches(id);
create unique index training_entries_batch_horse on public.training_entries(batch_id,horse_id) where batch_id is not null;
create function public.log_training_batch(p_request uuid,p_horses uuid[],p_date date,p_title text,p_notes text,p_duration integer default null) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; payload jsonb; saved jsonb; horse uuid;
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_request is null or p_date is null or p_date>(now() at time zone 'America/Chicago')::date then raise exception 'Choose an actual training date'; end if;
 if cardinality(p_horses) is null or cardinality(p_horses) not between 1 and 100 or array_position(p_horses,null) is not null then raise exception 'Choose between 1 and 100 horses'; end if;
 select array_agg(distinct h order by h) into ids from unnest(p_horses) h;
 if cardinality(ids)<>cardinality(p_horses) then raise exception 'Choose each horse only once'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 200 or p_notes is null or length(trim(p_notes)) not between 1 and 5000 then raise exception 'Enter a focus and notes for this session'; end if;
 if p_duration is not null and p_duration not between 1 and 1440 then raise exception 'Duration must be between 1 and 1440 minutes'; end if;
 payload:=jsonb_build_object('horses',ids,'date',p_date,'title',trim(p_title),'notes',trim(p_notes),'duration',p_duration);
 insert into public.training_log_batches(id,payload) values(p_request,payload) on conflict(id) do nothing;
 select b.payload into saved from public.training_log_batches b where b.id=p_request for update;
 if saved is distinct from payload then raise exception 'This request was already used for different session details. Open a new session form'; end if;
 -- Entries reference the batch via an immutable source key, retained even when edited.
 if exists(select 1 from public.training_entries where batch_id=p_request) then return; end if;
 -- A retry must remain a no-op even if all its log entries were later deleted.
 if (select count(*) from public.training_log_batches where id=p_request and completed_at is not null)>0 then return; end if;
 foreach horse in array ids loop
   perform 1 from public.horses where id=horse for no key update;
   if not exists(select 1 from public.training_stays where horse_id=horse and arrival_date<=p_date and (departure_date is null or departure_date>=p_date)) then raise exception 'Every selected horse must have a training stay covering the session date'; end if;
   insert into public.training_entries(horse_id,kind,entry_date,title,notes,duration_minutes,batch_id) values(horse,'session',p_date,trim(p_title),trim(p_notes),p_duration,p_request);
 end loop;
 update public.training_log_batches set completed_at=now() where id=p_request;
end; $$;
revoke all on function public.log_training_batch(uuid,uuid[],date,text,text,integer) from public,anon;
grant execute on function public.log_training_batch(uuid,uuid[],date,text,text,integer) to authenticated;
