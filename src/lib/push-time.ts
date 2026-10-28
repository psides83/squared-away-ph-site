export function pushReminderTime(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length !== 5 ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
  )
    throw Error("Choose a valid reminder time.");
  return value;
}
export function pushTimeLabel(value: string | null | undefined) {
  if (!value) return "During the daily check";
  const time = pushReminderTime(value.slice(0, 5))!;
  const hour = Number(time.slice(0, 2));
  return `At or after ${hour % 12 || 12}:${time.slice(3)} ${hour >= 12 ? "PM" : "AM"} Central`;
}
export function frequentPushConfigured(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" &&
    env.PUSH_FREQUENT_CHECKS === "1" &&
    (!env.CRON_SECRET || env.CRON_SECRET !== env.PUSH_CRON_SECRET) &&
    (env.PUSH_CRON_SECRET?.length ?? 0) >= 32
  );
}
export function configuredReminderTime(value: unknown, available: boolean) {
  const time = pushReminderTime(value);
  if (time !== null && !available)
    throw Error(
      "Custom times require the frequent notification check to be configured first. Use the daily check for now.",
    );
  return time;
}
