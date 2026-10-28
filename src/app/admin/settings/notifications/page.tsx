import { frequentPushConfigured } from "@/lib/push-time";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { pushConfig } from "@/lib/web-push";
import { PushSettings, type PushDevice } from "@/components/push-settings";
import { PageHeading, Notice } from "@/components/ui";
import { HelpPanel } from "@/components/help-panel";
export default async function Notifications() {
  const { db } = await requireAdmin();
  const config = pushConfig(process.env);
  const [devices, history] = await Promise.all([
    db
      .from("admin_push_devices")
      .select(
        "id,endpoint,vapid_public,label,enabled,supplier_alerts,scheduler_alerts,supplier_days,care_alerts,supplier_interval_days,reminder_time",
      )
      .order("updated_at", { ascending: false }),
    db
      .from("admin_push_deliveries")
      .select("id,kind,state,created_at,attempts")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return (
    <>
      <Link className="button secondary" href="/admin/settings">
        Back to settings
      </Link>
      <PageHeading
        title="Device notifications"
        description="Choose where care reminders, supplier follow-ups and scheduler failure alerts arrive."
      />
      <HelpPanel title="Timing, privacy and device setup">
        <p>
          Overdue supplier follow-ups produce at most one reminder per connected
          device on each selected business day, subject to that device’s minimum
          interval (1–30 calendar days). The interval starts after an alert is
          accepted by the push service, not after a failed attempt. This is
          checked on the configured schedule. A chosen reminder time delays
          supplier and care alerts until that Central Time clock time, then the
          next check can send them. This is approximate delivery, not an exact
          alarm. Scheduler failures produce at most one alert per device per
          business day when a scheduled check reports failure. Alerts use
          general wording; names and financial amounts stay inside the signed-in
          app.
        </p>
        <p>
          Care reminders are optional and off until selected for each device. At
          most one daily reminder is queued when an unfinished task in Reminders
          is due today or overdue in Central Time. All reminder categories are
          included. Completed tasks and future dates do not trigger it. These
          reminders are independent of supplier weekdays and share the device’s
          preferred time. Existing devices keep the daily check until you choose
          a custom time.
        </p>
        <p>
          On iPhone and iPad, add this app to your Home Screen and open it there
          before enabling notifications. The browser asks for permission only
          when you choose Enable. Delivery depends on device settings and
          connectivity. Disabling here stops new sends but does not change
          browser permission.
        </p>
        <p>
          Frequent notification checks require separate production setup on
          Hobby hosting. A scheduler that never runs, or an outage that prevents
          the server reaching the notification queue, cannot report its own
          failure through this channel. External uptime monitoring remains
          separate. Permission changes, expired subscriptions and browser data
          removal may require reconnecting the device.
        </p>
      </HelpPanel>
      {devices.error || history.error ? (
        <Notice error="Notification settings could not load. Check the latest migration." />
      ) : (
        <>
          <PushSettings
            timingAvailable={
              Boolean(config) && frequentPushConfigured(process.env)
            }
            publicKey={config?.publicKey ?? ""}
            configured={
              Boolean(config) && process.env.VERCEL_ENV === "production"
            }
            devices={(devices.data ?? []) as PushDevice[]}
          />
          <HelpPanel title="Recent delivery activity (latest 20)">
            {!history.data?.length && <p>No alerts queued yet.</p>}
            {history.data?.map((row) => (
              <p key={row.id}>
                {row.kind === "supplier"
                  ? "Supplier follow-up"
                  : row.kind === "care"
                    ? "Care reminders"
                    : "Scheduler failure"}{" "}
                ·{" "}
                {row.state === "sent" ? "Accepted by push service" : row.state}{" "}
                ·{" "}
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "America/Chicago",
                }).format(new Date(row.created_at))}{" "}
                · {row.attempts} attempts
              </p>
            ))}
            <p>
              Accepted does not guarantee that a device displayed the alert.
            </p>
          </HelpPanel>
        </>
      )}
    </>
  );
}
