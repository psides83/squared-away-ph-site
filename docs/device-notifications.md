# Administrator device notifications

Code supports device push for overdue supplier follow-ups on selected days and scheduler failures. Code completion is separate from production configuration and a real device receiving an alert.

## Production setup

1. Apply `20261023005500_admin_push.sql`, then `20261023005600_supplier_push_days.sql`, after the previous migrations.
2. Run `npm run setup:push` once in the repository. It writes a Git-ignored, owner-readable `.env.push.local` and refuses to overwrite an existing file. The script prints no keys. Keep this pair persistent; do not regenerate it per deployment.
3. Copy the three values from that file into Vercel **Production**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. The subject defaults to the known production site URL. Keep the private key server-only. Store a secure backup of the pair.
4. Ensure the existing production `CRON_SECRET` and Supabase server secret/service-role key are configured, and that the daily `/api/cron/billing` schedule is registered. See [automatic billing](automatic-billing.md). The coordinator checks push even when invoice and recurring-expense generation are both disabled; enabling push does not enable either financial automation.
5. Redeploy after setting the public key, which is also a build-time setting. Preview environments reject registration and scheduled dispatch. Missing or mismatched VAPID keys leave push unavailable while existing financial automation continues.
6. Open **Settings → Device notifications**, name the device, choose alert types, then tap **Enable on this device** and approve the browser permission request yourself. No permission prompt appears merely from opening settings. On iOS/iPadOS, first add the app to the Home Screen and open that installed app.
7. Use **Send test notification** on the connected device. Tests are limited to one per minute per device. Check the device’s notifications and tap the notification to verify the signed-in destination. Provider acceptance is not proof that the device displayed it.

Never paste private keys into chat or commit `.env.push.local`. Production values were not set by this code increment.

## Timing and failure boundaries

- Uses the existing daily scheduled check. Supplier reminders are at most one per connected device on each selected Central Time business day when any active return has a positive overdue known cash or store-credit target. There is no separate supplier notification if targets are unset or fulfilled. Issued store credit satisfies a target even after it is spent. The view in Supplier follow-up holds the details.
- Scheduler failure alerts are at most one per device per business day when the coordinator reports an error/blocked state or its database worker call fails. Review-only and busy outcomes do not imply failure. Notification-delivery failures do not manufacture a billing-failure alert.
- A skipped/never-invoked cron, missing scheduler credentials, or an outage preventing access to the queue cannot notify itself. Independent uptime monitoring remains necessary for that case.
- Up to 20 deliveries are claimed per invocation and sent five at a time; each administrator can connect up to ten enabled devices. Claims carry a five-minute lease and a unique token. Failed attempts retry after five minutes, at most three attempts per day when the endpoint is invoked again. There is no separate retry cron; a single daily invocation may leave a transient failure undelivered that day. Pending alerts from previous days expire rather than sending stale reminders. Provider/settlement ambiguity can still produce a duplicate after a crash; delivery is not exactly-once.
- Each encrypted request has a four-second deadline, refuses redirects, uses a one-hour TTL, and targets supported Apple/Google/Mozilla/Windows push service hosts only. The endpoint duration is 120 seconds to allow the existing 45-second worker plus bounded dispatch. Verify the deployment plan supports that duration.
- HTTP 404/410 expires a device subscription; a late response cannot disable a newly reconnected version. Reconnect on that device if needed. Key rotation also requires reconnecting devices. Reset browser connection is available for stale subscriptions.
- Missing administrator membership, disabled devices and disabled alert types stop new queued sends. An alert already in transit may still arrive. Disabling in the app does not revoke browser permission; browser settings control that separately.

## Data and verification

Subscription endpoints and encryption keys are private to their administrator and service-only sender. Customers cannot subscribe through this feature. Notification payloads contain general operational wording and allowlisted admin paths; they contain no customer/horse names, invoice amounts or supplier balances. No private pages, API responses or financial records are cached by the push-only service worker.

Delivery logs contain type, state, attempt count and HTTP status code, never provider response bodies or encryption keys. Settings shows the latest 20 delivery records. “Accepted by push service” does not mean displayed/read. Up to 500 completed/expired operational logs older than 90 days are removed per queue check; financial records are untouched. Browser/system notification permission controls are intentionally system interfaces.

Local tests use a database emulator and mocked push transport. Production migrations, VAPID/scheduler configuration, actual permission prompts, lock-screen delivery and physical iOS/Android verification remain deployment/device checks.

References: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps), [Apple Web Push guidance](https://webkit.org/blog/13878/), [web-push library](https://github.com/web-push-libs/web-push).

## Supplier reminder days

Each device selects its own Monday–Sunday reminder days, with Every day and Weekdays shortcuts. Existing devices default to all seven days. Choose one day for a weekly reminder, several days for a selected schedule, or all seven for daily reminders. At least one day remains required as the saved schedule; use the supplier-alert toggle to turn supplier reminders off. Changing these days does not change the daily cron’s check time or the scheduler-failure channel. Pending alerts on an unselected day expire. Re-selecting the day does not resurrect an already expired daily alert; the next eligible business day creates a new one. Custom send times and every-N-day intervals are not implemented.
