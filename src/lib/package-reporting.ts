import { cents, identifier, text } from "./validation.ts";
export function packageReportingValues(form: FormData) {
  return {
    p_request: identifier(form, "request_id", true),
    p_stay: identifier(form, "stay_id", true),
    p_current: identifier(form, "current"),
    p_feed: cents(form, "feed"),
    p_board: cents(form, "board"),
    p_reason: text(form, "reason", true, 2000),
  };
}
export type PackageAgreement = {
  id: string;
  monthly_cents: number;
  feed_cents: number;
  board_cents: number;
  reason: string;
};
export type PackageRevenue = {
  adjustments: ReportingAdjustment[];
  totals: {
    feed_cents: number;
    board_cents: number;
    training_cents: number;
    unallocated_cents: number;
  };
  lines: {
    id: string;
    invoice_id: string;
    invoice_number: number;
    issue_date: string;
    horse_name: string | null;
    amount_cents: number;
    feed_cents: number | null;
    board_cents: number | null;
    training_cents: number | null;
    has_adjustments: boolean;
  }[];
};
export type AdjustmentAllocation = {
  id: string;
  training_cents: number;
  feed_cents: number;
  board_cents: number;
  other_cents: number;
  reason: string;
};
export type ReportingAdjustment = {
  id: string;
  invoice_id: string;
  invoice_number: number;
  amount_cents: number;
  adjustment_date: string;
  description: string;
  allocation: AdjustmentAllocation | null;
};
export function adjustmentReportingValues(form: FormData) {
  return {
    p_request: identifier(form, "request_id", true),
    p_adjustment: identifier(form, "adjustment_id", true),
    p_current: identifier(form, "current"),
    p_training: cents(form, "training"),
    p_feed: cents(form, "feed"),
    p_board: cents(form, "board"),
    p_other: cents(form, "other"),
    p_reason: text(form, "reason", true, 2000),
  };
}
