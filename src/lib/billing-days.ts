import { cents, choice, dateValue, identifier, text } from "./validation.ts";
export const serviceModes = [
  "unrecorded",
  "included",
  "separate_monthly",
  "at_cost",
  "not_provided",
] as const;
export const serviceLabels: Record<string, string> = {
  unrecorded: "Not recorded",
  included: "Included in training",
  separate_monthly: "Separate monthly rate",
  at_cost: "Charge actual cost",
  not_provided: "Not provided",
};
export const dayLabels: Record<string, string> = {
  worked: "Worked",
  rest: "Billable rest",
  nonbillable: "Non-billable",
  unmarked: "Unclassified",
};
export function stayServiceValues(form: FormData) {
  const feed = choice(form, "feed_billing", serviceModes);
  const boarding = choice(form, "boarding_billing", serviceModes);
  return {
    feed_billing: feed,
    feed_monthly_cents:
      feed === "separate_monthly" ? cents(form, "feed_monthly_rate") : null,
    boarding_billing: boarding,
    boarding_monthly_cents:
      boarding === "separate_monthly"
        ? cents(form, "boarding_monthly_rate")
        : null,
  };
}
export function trainingDayValues(form: FormData) {
  const from = dateValue(form, "from", true)!;
  const to = dateValue(form, "to", true)!;
  if (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000)
    throw new Error("Choose a valid range of at most 366 days.");
  return {
    p_stay: identifier(form, "stay_id", true),
    p_from: from,
    p_to: to,
    p_status: choice(form, "status", [
      "worked",
      "rest",
      "nonbillable",
      "clear",
    ]),
    p_notes: text(form, "notes", false, 5000),
  };
}
export function monthDates(
  month: string,
  arrival: string,
  departure: string | null,
  today: string,
) {
  if (
    !/^\d{4}-\d{2}$/.test(month) ||
    Number(month.slice(0, 4)) < 1900 ||
    Number(month.slice(5)) < 1 ||
    Number(month.slice(5)) > 12
  )
    throw new Error("Choose a valid calendar month.");
  const first = `${month}-01`;
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const from = [first, arrival].sort().at(-1)!;
  const to = [last, departure ?? last, today].sort()[0];
  const dates: string[] = [];
  for (
    let timestamp = Date.parse(from);
    timestamp <= Date.parse(to);
    timestamp += 86400000
  )
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  return dates;
}
export function summarizeDays(
  dates: string[],
  entries: { day: string; status: string }[],
) {
  const result = {
    worked: 0,
    rest: 0,
    nonbillable: 0,
    unmarked: 0,
    billable: 0,
  };
  const lookup = new Map(entries.map((entry) => [entry.day, entry.status]));
  for (const d of dates) {
    const status = lookup.get(d);
    if (status === "worked") result.worked++;
    else if (status === "rest") result.rest++;
    else if (status === "nonbillable") result.nonbillable++;
    else result.unmarked++;
  }
  result.billable = result.worked + result.rest;
  return result;
}
