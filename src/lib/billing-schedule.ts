import { choice, dateValue, text } from "./validation.ts";
export const billingSchedules = [
  "first_of_month",
  "arrival_anniversary",
  "custom",
] as const;
export const billingScheduleLabels: Record<string, string> = {
  first_of_month: "First of month",
  arrival_anniversary: "Arrival anniversary",
  custom: "Custom day",
};
export function billingScheduleValues(form: FormData) {
  const arrival = dateValue(form, "arrival_date", true)!;
  const schedule = form.get("billing_schedule")
    ? choice(form, "billing_schedule", billingSchedules)
    : "custom";
  const day =
    schedule === "first_of_month"
      ? 1
      : schedule === "arrival_anniversary"
        ? Number(arrival.slice(8))
        : Number(text(form, "billing_day", true, 2));
  if (!Number.isInteger(day) || day < 1 || day > 31)
    throw new Error("Choose a billing day from 1 to 31.");
  const enabled = form.get("recurring_enabled") === "on";
  const start = enabled
    ? dateValue(form, "recurring_start_date", true)
    : dateValue(form, "recurring_start_date");
  if (start && start < arrival)
    throw new Error("Recurring billing cannot start before arrival.");
  const departure = dateValue(form, "departure_date");
  if (start && departure && start > departure)
    throw new Error("Recurring billing must start before or on departure.");
  return {
    billing_schedule: schedule,
    billing_day: day,
    recurring_enabled: enabled,
    recurring_start_date: start,
  };
}
