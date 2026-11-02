import { dateValue, identifier, text, choice } from "./validation.ts";
import type { CombinedServiceReportData } from "./../components/combined-service-report";
import type { OtherIncomeReportData } from "./other-income";
export type ProfitReview = {
  id: string;
  source_token: string;
  effect: "none" | "cost" | "gain" | "settlement";
  recognition_date: string;
  submitted_cents: number;
  profit_cents: number;
  reason: string;
  cleared: boolean;
  retired_at: string | null;
  captured_source: {
    label?: string;
    stock_cents?: number;
    cash_cents?: number;
    credit_cents?: number;
  };
};
export type ProfitInventorySource = {
  source_kind: "correction" | "return" | "credit";
  source_id: string;
  detail_kind: string;
  label: string;
  source_date: string;
  minimum_date: string;
  product_id: string | null;
  stock_cents: number;
  cash_cents: number;
  credit_cents: number;
  expected_cash_cents: number | null;
  expected_credit_cents: number | null;
  source_token: string;
  valid: boolean;
  current: ProfitReview | null;
  history: ProfitReview[];
};
export type ProfitInventoryOptions = {
  kind: ProfitInventorySource["source_kind"];
  count: number;
  pending_count: number;
  rows: ProfitInventorySource[];
};
export function profitReviewValues(f: FormData) {
  const raw = text(f, "amount_cents", true, 16)!;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw Error("Reopen the review to load the saved financial value.");
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Reopen the current source review.");
  return {
    p_request: identifier(f, "request_id", true),
    p_kind: choice(f, "source_kind", ["return", "correction", "credit"]),
    p_source: identifier(f, "source_id", true),
    p_current: identifier(f, "current"),
    p_token: token,
    p_effect: choice(f, "effect", ["none", "cost", "gain", "settlement"]),
    p_date: dateValue(f, "recognition_date", true),
    p_cents: Number(raw),
    p_reason: text(f, "reason", true, 2000),
    p_clear: f.get("clear") === "yes",
  };
}
export type BusinessProfitData = {
  totals: {
    income_cents: number;
    service_cost_cents: number;
    other_cost_cents: number;
    waste_cost_cents: number;
    waste_count: number;
    inventory_adjustment_cents: number;
    cost_cents: number;
    needs_review: boolean;
    profit_cents: number | null;
    margin_percent: number | null;
  };
  services: CombinedServiceReportData;
  other_income: OtherIncomeReportData;
  undated_income_count: number;
  undated_income: {
    line_id: string;
    invoice_id: string;
    invoice_number: number | null;
    description: string;
  }[];
  adjustment_review_count: number;
  adjustment_review: {
    adjustment_id: string;
    invoice_id: string;
    invoice_number: number | null;
  }[];
  cost_review_count: number;
  unreviewed_cost_cents: number;
  cost_review: {
    expense_id: string;
    vendor: string | null;
    eligible_cents: number;
  }[];
  inventory_review_counts: {
    correction: number;
    return: number;
    credit: number;
  };
  inventory_review: {
    source_kind: ProfitInventorySource["source_kind"];
    source_id: string;
    label: string;
    source_date: string;
    recognition_date: string | null;
  }[];
};
