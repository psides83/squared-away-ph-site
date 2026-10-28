-- Optional PRODUCTION setup, run by the project owner after migration 069 and deployment.
-- This is deliberately outside migrations: applying application migrations never enables a scheduler.
-- Enable Supabase Cron (pg_cron), pg_net and Vault first.
-- Create a Vault secret named saph_push_cron_secret using the dashboard, with the SAME
-- separate random 32+-character PUSH_CRON_SECRET configured in Vercel Production.
-- Never put the secret in this file, a migration, a job's literal command or chat.
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='saph_push_cron_secret' and length(decrypted_secret)>=32) then
  raise exception 'Create the matching saph_push_cron_secret in Vault before scheduling';
 end if;
end;$$;
-- Scheduling the same named job updates it rather than creating another copy.
select cron.schedule('saph-device-notifications','*/5 * * * *',$job$
 select net.http_post(
  url := 'https://squaredawayperformancehorses.vercel.app/api/cron/notifications',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='saph_push_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
 );
$job$);
-- To stop checks, run: select cron.unschedule('saph-device-notifications');
-- Also set PUSH_FREQUENT_CHECKS=0 in Vercel and redeploy, then switch timed devices
-- to "Use the daily check" if you want their supplier/care reminders on the daily run.
