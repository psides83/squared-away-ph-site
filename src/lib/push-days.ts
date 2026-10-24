export const PUSH_DAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 7, label: "Sun" },
] as const;
export function supplierPushDays(values: unknown): number[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 7 ||
    values.some(
      (v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 7,
    ) ||
    new Set(values).size !== values.length
  )
    throw new Error("Choose at least one supplier reminder day.");
  return [...values].sort((a, b) => a - b);
}
export function pushDaysLabel(days: readonly number[]) {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)))
    return "Weekdays";
  return PUSH_DAYS.filter((d) => days.includes(d.id))
    .map((d) => d.label)
    .join(", ");
}
