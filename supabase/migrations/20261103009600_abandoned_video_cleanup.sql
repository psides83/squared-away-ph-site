begin;
alter table public.horse_video_uploads
 add column cleanup_started_at timestamptz,
 add column cleaned_at timestamptz,
 add column cleanup_checked_at timestamptz,
 add column cleanup_attempts integer not null default 0,
 add column cleanup_failed boolean not null default false,
 add constraint video_cleanup_state check (
  (cleanup_started_at is null and cleaned_at is null) or
  (cleanup_started_at is not null and abandoned_at is not null and attached_at is null and (cleaned_at is null or cleaned_at>=cleanup_started_at)));
create function public.guard_video_cleanup() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.cleanup_started_at is not null and row(new.horse_id,new.object_path,new.abandoned_at,new.attached_at,new.abandoned_reason,new.sha256) is distinct from row(old.horse_id,old.object_path,old.abandoned_at,old.attached_at,old.abandoned_reason,old.sha256) then
  raise exception 'This abandoned upload has entered permanent cleanup. Start a new upload instead';
 end if;
 return new;
end;$$;
create trigger video_cleanup_guard before update on public.horse_video_uploads for each row execute function public.guard_video_cleanup();
create function public.guard_cleaned_video_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind='video' then
  perform 1 from public.horse_video_uploads u where u.id=new.id or u.object_path=new.object_path for update;
 end if;
 if new.kind='video' and exists(select 1 from public.horse_video_uploads u where u.cleanup_started_at is not null and (u.id=new.id or u.object_path=new.object_path)) then
  raise exception 'This video has entered permanent cleanup. Start a new upload instead';
 end if;
 return new;
end;$$;
create trigger cleaned_video_attachment_guard before insert or update on public.horse_files for each row execute function public.guard_cleaned_video_attachment();
-- Service worker freezes only explicitly set-aside, unattached uploads. Restoring before
-- the claim wins the same row lock. No untracked object or pending upload is inferred abandoned.
create function public.claim_abandoned_video_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 with candidates as (
 select u.id from public.horse_video_uploads u
 where u.cleanup_started_at is null and u.attached_at is null and u.abandoned_at<=now()-interval '30 days'
 and not exists(select 1 from public.horse_files f where f.id=u.id or f.object_path=u.object_path)
 order by u.abandoned_at,u.id limit 20 for update skip locked
 ) update public.horse_video_uploads u set cleanup_started_at=now(),revision=revision+1 from candidates c where u.id=c.id;
 -- Wait beyond the existing 24-hour resumable-transfer window before deleting bytes.
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'horse_id',u.horse_id,'path',u.object_path,'content_type',u.content_type)) from (
 select u.* from public.horse_video_uploads u where u.cleanup_started_at<=now()-interval '48 hours' and u.cleaned_at is null
 and u.attached_at is null and u.abandoned_at is not null
 and not exists(select 1 from public.horse_files f where f.id=u.id or f.object_path=u.object_path)
 order by u.cleanup_checked_at nulls first,u.cleanup_started_at,u.id limit 5
 )u),'[]'::jsonb);
end;$$;
create function public.record_abandoned_video_cleanup(p_id uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_success is null then raise exception 'Choose a cleanup result';end if;
 update public.horse_video_uploads u set cleanup_checked_at=now(),cleanup_attempts=cleanup_attempts+1,cleanup_failed=not p_success,
 cleaned_at=case when p_success then now() else null end
 where u.id=p_id and u.cleanup_started_at<=now()-interval '48 hours' and u.cleaned_at is null
 and u.attached_at is null and u.abandoned_at is not null
 and not exists(select 1 from public.horse_files f where f.id=u.id or f.object_path=u.object_path);
end;$$;
revoke all on function public.claim_abandoned_video_cleanup(),public.record_abandoned_video_cleanup(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_abandoned_video_cleanup(),public.record_abandoned_video_cleanup(uuid,boolean) to service_role;
revoke all on function public.guard_video_cleanup(),public.guard_cleaned_video_attachment() from public,anon,authenticated;
commit;
