import { dateValue, identifier, text } from "./validation.ts";
export function manualFeedPeriodValues(f: FormData) {
  const amount = text(f, "amount_cents", true, 10)!;
  if (!/^-?\d+$/.test(amount) || Math.abs(Number(amount)) > 100000000)
    throw Error("The saved charge must be a valid whole-cent amount.");
  return {
    p_request: identifier(f, "request_id", true),
    p_line: identifier(f, "line_id", true),
    p_current: identifier(f, "current"),
    p_horse: identifier(f, "horse_id", true),
    p_stay: identifier(f, "stay_id"),
    p_amount: Number(amount),
    p_from: dateValue(f, "from", true),
    p_to: dateValue(f, "to", true),
    p_reason: text(f, "reason", true, 2000),
    p_clear: f.get("clear") === "yes",
  };
}
export type ManualFeedPeriod = {
  id: string;
  horse_id: string;
  stay_id: string | null;
  amount_cents: number;
  covered_from: string;
  covered_to: string;
  reason: string;
  cleared: boolean;
  retired_at: string | null;
};
export type ManualFeedLine = {
  id: string;
  description: string;
  amount_cents: number;
  status: string;
  issue_date: string;
  period_from: string | null;
  period_to: string | null;
  horse_id: string | null;
  stay_id: string | null;
  horse_name: string | null;
  has_saved_period: boolean;
  valid: boolean;
  current: ManualFeedPeriod | null;
  history: ManualFeedPeriod[];
};
export type ManualFeedOptions = { count: number; lines: ManualFeedLine[] };
