"use client";
import { useEffect, useState, useActionState, startTransition } from "react";
import { PushReminderTime } from "@/components/push-reminder-time";
import { pushTimeLabel } from "@/lib/push-time";
import { PushDayPicker } from "@/components/push-day-picker";
import { pushDaysLabel, pushIntervalLabel } from "@/lib/push-days";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import {
  registerPushDevice,
  testPushDevice,
  savePushPreferences,
} from "@/app/admin/settings/notifications/actions";
import { FormInput } from "@/components/form-input";
import { Field, Notice } from "@/components/ui";
import { ActionPanel } from "@/components/action-panel";
import { SubmitButton } from "@/components/submit-button";
export type PushDevice = {
  id: string;
  endpoint: string;
  vapid_public: string;
  label: string;
  enabled: boolean;
  supplier_alerts: boolean;
  supplier_days: number[];
  supplier_interval_days?: number;
  scheduler_alerts: boolean;
  care_alerts: boolean;
  reminder_time?: string | null;
};
export function PushSettings({
  publicKey,
  configured,
  devices,
  timingAvailable = false,
}: {
  publicKey: string;
  configured: boolean;
  devices: PushDevice[];
  timingAvailable?: boolean;
}) {
  const router = useRouter();
  const [worker, setWorker] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [current, setCurrent] = useState<string | null>(null);
  const [support, setSupport] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [label, setLabel] = useState("My device");
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [interval, setInterval] = useState(1);
  const [reminderTime, setReminderTime] = useState<string | null>(null);
  const [supplier, setSupplier] = useState(true),
    [scheduler, setScheduler] = useState(true),
    [care, setCare] = useState(false);
  useEffect(() => {
    let active = true;
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      !window.isSecureContext
    ) {
      setSupport("unsupported");
      return;
    }
    setSupport(Notification.permission === "denied" ? "denied" : "supported");
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then(async (registration) => {
        if (!active) return;
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        setSubscription(subscription);
        setWorker(registration);
        if (active)
          setCurrent(
            devices.find(
              (d) =>
                d.endpoint === subscription?.endpoint &&
                d.enabled &&
                d.vapid_public === publicKey &&
                Notification.permission === "granted",
            )?.id ?? null,
          );
      })
      .catch(() => {
        if (active)
          setError(
            "Notifications could not prepare on this device. Refresh and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [devices, publicKey]);
  const enable = async () => {
    if (!worker || busy) return;
    setError(undefined);
    setSuccess(undefined);
    setBusy(true);
    try {
      // Subscribe starts directly from the click, so the browser owns the permission prompt.
      const decoded = Uint8Array.from(
        atob(
          publicKey.replace(/-/g, "+").replace(/_/g, "/") +
            "=".repeat((4 - (publicKey.length % 4)) % 4),
        ),
        (c) => c.charCodeAt(0),
      );
      const existing = subscription;
      if (
        existing?.options.applicationServerKey &&
        new Uint8Array(existing.options.applicationServerKey).some(
          (byte, index) => byte !== decoded[index],
        )
      ) {
        await existing.unsubscribe();
        setSubscription(null);
        setCurrent(null);
        setSuccess(
          "Device connection refreshed. Tap Enable on this device again to connect.",
        );
        return;
      }
      const connected =
        existing ??
        (await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decoded,
        }));
      setSubscription(connected);
      const result = await registerPushDevice(
        connected.toJSON(),
        label,
        supplier,
        scheduler,
        days,
        care,
        interval,
        reminderTime,
      );
      if (result.error) throw new Error(result.error);
      setCurrent(result.id ?? null);
      setSuccess("Device connected. Alerts follow your selected preferences.");
      router.refresh();
    } catch (e) {
      if ("Notification" in window && Notification.permission === "denied")
        setSupport("denied");
      setError(
        e instanceof Error ? e.message : "Could not enable notifications.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>This device</h2>
          {current ? (
            <Bell size={20} aria-hidden="true" />
          ) : (
            <BellOff size={20} aria-hidden="true" />
          )}
        </div>
        <div className="record-form stack">
          <Notice error={error} success={success} />
          {!configured && (
            <p className="notice">
              Push delivery needs production setup before devices can connect.
            </p>
          )}
          {support === "unsupported" && (
            <p className="notice">
              Push is unavailable in this browser view. On iPhone or iPad, add
              Squared Away to your Home Screen, then open it there.
            </p>
          )}
          {support === "denied" && (
            <p className="notice">
              Notifications are blocked. Allow them in your browser or device
              notification settings, then return here.
            </p>
          )}
          {current ? (
            <>
              <p className="notice success">
                This device is connected. Manage its alert preferences below.
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  disabled={busy || !configured}
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    setError(undefined);
                    setSuccess(undefined);
                    try {
                      const result = await testPushDevice(current);
                      setError(result.error);
                      setSuccess(result.success);
                    } catch {
                      setError("Could not send the device test.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Send test notification
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                Device name
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={80}
                  required
                  placeholder="e.g. My iPhone"
                />
              </label>
              <label className="inline-checkbox push-option">
                <input
                  type="checkbox"
                  checked={supplier}
                  onChange={(e) => setSupplier(e.target.checked)}
                />
                Overdue supplier follow-ups
              </label>
              <PushDayPicker days={days} onChange={setDays} disabled={busy} />
              <label className="field">
                Minimum days between supplier reminders
                <FormInput
                  aria-label="Minimum days between supplier reminders"
                  type="number"
                  min="1"
                  max="30"
                  step="1"
                  suffix="days"
                  value={interval}
                  disabled={busy}
                  onChange={(e) => setInterval(Number(e.target.value))}
                />
              </label>
              <p className="form-hint muted">
                After a supplier alert is accepted by the push service, wait
                this many calendar days, then use the next selected weekday. The
                first alert uses the next eligible check. Failed attempts do not
                start this waiting period.
              </p>
              <label className="inline-checkbox push-option">
                <input
                  type="checkbox"
                  checked={scheduler}
                  onChange={(e) => setScheduler(e.target.checked)}
                />
                Scheduled automation failures
              </label>
              <label className="inline-checkbox push-option">
                <input
                  type="checkbox"
                  checked={care}
                  onChange={(e) => setCare(e.target.checked)}
                />
                Due and overdue care reminders
              </label>
              <p className="muted">
                At most one care reminder per day, independently of supplier
                reminder days.
              </p>
              <PushReminderTime
                value={reminderTime}
                onChange={setReminderTime}
                available={timingAvailable}
                disabled={busy}
              />
              <div className="form-actions">
                <button
                  className="button"
                  type="button"
                  disabled={
                    !configured ||
                    !worker ||
                    support !== "supported" ||
                    busy ||
                    !label.trim() ||
                    !days.length ||
                    !Number.isInteger(interval) ||
                    interval < 1 ||
                    interval > 30 ||
                    (reminderTime !== null &&
                      (!timingAvailable ||
                        !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(reminderTime)))
                  }
                  onClick={enable}
                >
                  <Bell size={18} aria-hidden="true" />
                  {busy ? "Connecting…" : "Enable on this device"}
                </button>
              </div>
              {subscription && (
                <div className="form-actions">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(undefined);
                      try {
                        await subscription.unsubscribe();
                        setSubscription(null);
                        setCurrent(null);
                        setSuccess(
                          "Browser connection cleared. Tap Enable again to reconnect.",
                        );
                      } catch {
                        setError("Could not clear this browser connection.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Reset browser connection
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <h2>Your connected devices</h2>
      {!devices.length && <p className="notice">No devices connected yet.</p>}
      {devices.map((device) => (
        <section className="panel" key={device.id}>
          <div className="panel-heading">
            <h3>
              {device.label}
              {device.id === current ? " · This device" : ""}
            </h3>
            <span className="tag">
              {device.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="record-form stack">
            <p>
              {device.supplier_alerts
                ? `Supplier reminders: ${pushDaysLabel(device.supplier_days)} · ${pushIntervalLabel(device.supplier_interval_days ?? 1)}`
                : "Supplier reminders off"}{" "}
              ·{" "}
              {device.scheduler_alerts
                ? "Scheduler alerts on"
                : "Scheduler alerts off"}
              {" · "}
              {device.care_alerts
                ? "Care reminders daily"
                : "Care reminders off"}
            </p>
            <p className="muted">
              {pushTimeLabel(device.reminder_time)} for supplier and care
              reminders.
            </p>
            <ActionPanel id={`push-device-${device.id}`} label="Manage device">
              <PushPreferenceForm
                device={device}
                timingAvailable={timingAvailable}
              />
            </ActionPanel>
          </div>
        </section>
      ))}
    </>
  );
}
export function PushPreferenceForm({
  device,
  timingAvailable = false,
}: {
  device: PushDevice;
  timingAvailable?: boolean;
}) {
  const [reminderTime, setReminderTime] = useState<string | null>(
    device.reminder_time?.slice(0, 5) ?? null,
  );
  const [days, setDays] = useState(device.supplier_days);
  const [state, action, pending] = useActionState(savePushPreferences, {});
  return (
    <form
      className="record-form"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      <fieldset disabled={pending || Boolean(state.success)} className="stack">
        <input type="hidden" name="id" value={device.id} />
        <Field
          label="Device name"
          name="label"
          defaultValue={device.label}
          maxLength={80}
          required
        />
        <label className="inline-checkbox push-option">
          <input
            name="supplier"
            type="checkbox"
            defaultChecked={device.supplier_alerts}
          />
          Overdue supplier follow-ups
        </label>
        <PushDayPicker days={days} onChange={setDays} />
        <Field
          label="Minimum days between supplier reminders"
          name="supplier_interval_days"
          type="number"
          min="1"
          max="30"
          step="1"
          suffix="days"
          defaultValue={device.supplier_interval_days ?? 1}
          required
        />
        <p className="form-hint muted">
          Wait this many calendar days after an accepted supplier alert, then
          use the next selected weekday. Failed sends do not delay retries. Care
          and scheduler alerts use their own schedules.
        </p>
        <label className="inline-checkbox push-option">
          <input
            name="scheduler"
            type="checkbox"
            defaultChecked={device.scheduler_alerts}
          />
          Scheduled automation failures
        </label>
        <label className="inline-checkbox push-option">
          <input
            name="care"
            type="checkbox"
            defaultChecked={device.care_alerts}
          />
          Due and overdue care reminders
        </label>
        <p className="muted">
          A daily reminder when any unfinished task in Reminders is due today or
          overdue. Supplier reminder days do not change this schedule.
        </p>
        <PushReminderTime
          value={reminderTime}
          onChange={setReminderTime}
          available={timingAvailable}
        />
        <label className="inline-checkbox push-option">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={device.enabled}
            disabled={!device.enabled}
          />
          Allow alerts on this device
        </label>
        <p className="muted">
          To reconnect a disabled device, open Settings on that device and
          choose Enable. An alert already in transit may still arrive.
        </p>
        <div className="form-actions">
          <SubmitButton>Save device preferences</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
