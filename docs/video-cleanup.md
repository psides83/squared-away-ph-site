# Abandoned video cleanup

The owner chose automatic permanent cleanup after 30 days (November 3, 2026).

## Scope

Only an explicitly **set-aside** upload with no saved horse-file record qualifies. The 30 days start at the latest set-aside timestamp, not the original preparation date. Ordinary pending uploads and saved videos, including archived saved videos, are excluded. Matching either a saved file ID or its object path protects the upload. Unknown/untracked storage objects are not inferred abandoned.

At the first enabled daily check after 30 days, up to 20 eligible rows are locked and frozen for cleanup. Restore and attachment cannot race past this claim; new uploads must use new identifiers. Cleanup then waits another 48 hours, beyond the application's existing 24-hour resumable transfer window, before deleting bytes. Actual deletion therefore occurs no earlier than approximately 32 days after setting aside, and can be later due to schedule/backlog/errors. This is a permanent deletion of the abandoned file, not the saved horse video or its retained metadata/history.

The worker processes at most five ready uploads per run. It validates the exact horse/UUID/extension path and deletes only from the private `horse-videos` bucket using the Storage API, never SQL deletion from storage metadata. Missing objects are safe to retry. Only a successful API response marks completion; uncertain/failed removal stays retryable. A crash after removal but before recording also retries safely. Upload records retain cleanup start/completion, last check, attempt count and failure state. Existing set-aside/restore history stays intact. A failed completion write stops the batch. No thumbnails are deleted: saved thumbnails belong to saved horse files, which are excluded.

## Deployment (not performed)

1. Apply `20261103009600_abandoned_video_cleanup.sql` through the reviewed migration process.
2. Verify service-only cleanup RPC access and that the existing authenticated production daily endpoint `/api/cron/billing` is scheduled. Preview environments cannot run this endpoint. The worker shares the existing daily endpoint; no second Vercel Hobby cron is added.
3. Check the current financial automation settings separately and leave deferred billing/expense automation disabled as intended. Media cleanup is independent of those settings and does not enable either automation.
4. Set `MEDIA_CLEANUP_ENABLED=true` in production only when ready to enable permanent cleanup, then redeploy. Missing/false leaves cleanup disabled; applying the migration alone deletes nothing. Existing private server Supabase credentials and cron secret are used; nothing is exposed to browsers.
5. Before enabling against real uploads, verify storage token/session lifetime remains under the 48-hour safety wait, inspect the set-aside queue and test using disposable nonproduction uploads. Verify failures retry and saved files remain excluded. No live deletion has been performed during implementation.

A separate Storage client limits each request to five seconds; RPC calls also have bounded timeouts. The daily route retains its production and constant-time secret checks. Cleanup failures mark the overall run as error so existing scheduler-failure alerts can report a problem if configured. This does not provide independent missed-run/outage monitoring.

## Remaining media work

Discovery of untracked objects, expiring incomplete provider-side transfer sessions, transcoding and permanent cleanup of other media/abandoned preview objects remain unimplemented. Retained cleanup records are not automatically purged. Full per-attempt logs beyond the retained last result/counter are not provided.
