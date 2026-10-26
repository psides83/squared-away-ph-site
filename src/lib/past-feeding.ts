export function feedingDate(value: unknown) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value.slice(0, 4) !== "0000" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function previousFeedingDay(current: string) {
  const date = feedingDate(current);
  if (!date) throw Error("Choose a valid date.");
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
}
export function missedFeedingDate(value: unknown, current: string) {
  if (value === undefined) return previousFeedingDay(current);
  const date = feedingDate(value);
  if (!date || date > current)
    throw Error("Choose an actual feeding date on or before today.");
  return date;
}
export function feedingReturnPath(target: unknown, date: unknown) {
  const valid = feedingDate(date);
  return target === "past-feeding"
    ? `/admin/feeding/past${valid ? `?date=${valid}` : ""}`
    : target === "home"
      ? "/admin"
      : "/admin/feeding";
}

export function feedingResultUrl(
  target: unknown,
  date: unknown,
  error: string | undefined,
  extras: boolean,
) {
  const url = new URL(
    feedingReturnPath(target, date),
    "https://internal.invalid",
  );
  url.searchParams.set(
    error ? "error" : "success",
    error ??
      (extras
        ? "All feeding entries recorded together."
        : "Selected feeding-time rations confirmed. Already confirmed horses were not deducted again."),
  );
  if (target === "past-feeding" && extras) url.hash = "past-feeding-extras";
  return url.pathname + url.search + url.hash;
}
