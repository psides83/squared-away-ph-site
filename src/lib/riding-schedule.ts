export const ridingWeekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export type RidingDay = "training" | "off";
export type RidingSchedule = {
  horse_id: string;
  days: RidingDay[] | null;
  notes: string | null;
  version: string;
  updated_at: string;
};
export function ridingDayIndex(date: string) {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}
export function ridingPlanLabel(
  schedule: RidingSchedule | undefined | null,
  date: string,
) {
  const day = schedule?.days?.[ridingDayIndex(date)];
  return day === "training"
    ? "Planned training"
    : day === "off"
      ? "Planned off day"
      : "No riding plan";
}
export function parseRidingDays(value: string): RidingDay[] {
  const days: unknown = JSON.parse(value);
  if (
    !Array.isArray(days) ||
    days.length !== 7 ||
    days.some((d) => d !== "training" && d !== "off")
  )
    throw new Error("Choose training or off for every day of the week.");
  return days as RidingDay[];
}
