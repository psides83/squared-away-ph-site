import { dateValue, identifier, text } from "./validation.ts";
export function otherIncomePeriodValues(f: FormData) {
  const amount = text(f, "amount_cents", true, 10)!;
  if (!/^-?\d+$/.test(amount) || Math.abs(Number(amount)) > 100000000)
    throw Error("Choose a valid saved whole-cent amount.");
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Close and reopen the current income-period editor.");
  return {
    p_request: identifier(f, "request_id", true),
    p_line: identifier(f, "line_id", true),
    p_current: identifier(f, "current"),
    p_horse: identifier(f, "horse_id"),
    p_stay: identifier(f, "stay_id"),
    p_amount: Number(amount),
    p_from: dateValue(f, "from", true),
    p_to: dateValue(f, "to", true),
    p_reason: text(f, "reason", true, 2000),
    p_clear: f.get("clear") === "yes",
    p_token: token,
  };
}
export type OtherIncomePeriod = {
  id: string;
  horse_id: string | null;
  stay_id: string | null;
  amount_cents: number;
  covered_from: string;
  covered_to: string;
  source_token: string;
  reason: string;
  cleared: boolean;
  retired_at: string | null;
};
export type OtherIncomeLine = {
  id: string;
  description: string;
  amount_cents: number;
  status: string;
  period_from: string | null;
  period_to: string | null;
  horse_id: string | null;
  stay_id: string | null;
  horse_name: string | null;
  source_token: string | null;
  valid: boolean;
  current: OtherIncomePeriod | null;
  history: OtherIncomePeriod[];
};
export type OtherIncomeOptions = { count: number; lines: OtherIncomeLine[] };
export type OtherIncomeReportData = {
  count: number;
  rows: {
    line_id: string;
    invoice_id: string;
    basis: "manual" | "reimbursement";
    expense_id: string | null;
    covered_from: string;
    covered_to: string;
    cents: number;
    status: string;
    invoice_number: number | null;
    issue_date: string;
    customer_name: string;
    description: string;
    amount_cents: number;
  }[];
  totals: {
    reimbursement_cents: number;
    manual_cents: number;
    gross_cents: number;
    draft_cents: number;
    adjustment_cents: number;
    net_cents: number;
  };
  unmatched_count: number;
  unmatched_issued_count: number;
  unmatched: {
    source_kind: string;
    line_id: string;
    invoice_id: string;
    invoice_number: number | null;
    status: string;
    description: string;
    amount_cents: number;
  }[];
  unresolved_adjustment_count: number;
  adjustment_review: {
    adjustment_id: string;
    invoice_id: string;
    invoice_number: number | null;
  }[];
};
