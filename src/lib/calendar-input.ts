export function temporalError(
  value: string,
  type: string,
  min?: string | number,
  max?: string | number,
): string {
  if (!value) return "";
  const valid =
    type === "time"
      ? /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      : type === "month"
        ? /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
        : /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) &&
          !Number.isNaN(Date.parse(value + "T12:00:00Z")) &&
          new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
  if (!valid)
    return type === "time"
      ? "Enter a valid time in HH:mm format (24-hour clock)."
      : type === "month"
        ? "Enter a valid month in YYYY-MM format."
        : "Enter a valid date in YYYY-MM-DD format.";
  if (min && value < String(min)) return `Choose a value on or after ${min}.`;
  if (max && value > String(max)) return `Choose a value on or before ${max}.`;
  return "";
}
export function monthDays(month: string) {
  const first = new Date(month + "-01T12:00:00Z");
  if (Number.isNaN(first.getTime())) return [];
  const start = first.getUTCDay(),
    length = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
  return Array.from({ length: start + length }, (_, i) =>
    i < start ? null : `${month}-${String(i - start + 1).padStart(2, "0")}`,
  );
}
export function shiftMonth(month: string, offset: number) {
  const date = new Date(month + "-01T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
