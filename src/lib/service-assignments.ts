import { cents, dateValue, identifier, text } from "./validation.ts";
import type { ServiceCost } from "./service-profitability.ts";
export type AssignmentLine = {
  service: "training" | "board";
  horse_id: string;
  horse_name: string;
  stay_id: string | null;
  amount_cents: number;
  covered_from: string;
  covered_to: string;
};
export type AssignmentReview = {
  id: string;
  parent_id: string;
  reason: string;
  cleared: boolean;
  valid?: boolean;
  retired_at: string | null;
  lines: AssignmentLine[];
};
export type AssignmentOptions = {
  expense_id: string;
  source_horse_id: string | null;
  parent: ServiceCost | null;
  current: AssignmentReview | null;
  history: AssignmentReview[];
  horses: { id: string; barn_name: string }[];
  stays: {
    id: string;
    horse_id: string;
    arrival_date: string;
    departure_date: string | null;
  }[];
  options_truncated: boolean;
};
export type AssignmentDraft = {
  id: string;
  service: string;
  horse_id: string;
  stay_id: string;
  amount: string;
  covered_from: string;
  covered_to: string;
};
export function serviceAssignmentValues(f: FormData) {
  const clear = f.get("clear") === "yes";
  const parsed: unknown = JSON.parse(text(f, "rows", true, 30000)!);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 50 ||
    (!clear && !parsed.length) ||
    (clear && parsed.length)
  )
    throw Error("Enter 1 to 50 portions, or explicitly clear assignments.");
  const rows = parsed.map((r) => {
    if (
      !r ||
      typeof r !== "object" ||
      !["training", "board"].includes(r.service)
    )
      throw Error("Choose a service for each portion.");
    const row = new FormData();
    for (const key of ["horse_id", "stay_id", "covered_from", "covered_to"])
      row.set(key, String(r[key] ?? ""));
    row.set("amount", String(r.amount ?? ""));
    const amount = cents(row, "amount");
    if (amount <= 0) throw Error("Each portion must have a positive amount.");
    const from = dateValue(row, "covered_from", true)!,
      to = dateValue(row, "covered_to", true)!;
    if (from > to) throw Error("Covered dates must be in order.");
    return {
      service: r.service,
      horse_id: identifier(row, "horse_id", true),
      stay_id: identifier(row, "stay_id"),
      amount_cents: amount,
      covered_from: from,
      covered_to: to,
    };
  });
  return {
    p_request: identifier(f, "request_id", true),
    p_expense: identifier(f, "expense_id", true),
    p_parent: identifier(f, "parent_id", true),
    p_current: identifier(f, "current"),
    p_rows: rows,
    p_reason: text(f, "reason", true, 2000),
    p_clear: clear,
  };
}
export type ServiceFigures = {
  service: string;
  gross_cents: number;
  draft_cents: number;
  adjustment_cents: number;
  cost_cents: number;
};
export type EntityMargins = {
  scope: "horse" | "stay";
  count: number;
  rows: {
    entity_id: string;
    horse_id: string;
    stay_id: string | null;
    name: string;
    arrival_date: string | null;
    departure_date: string | null;
    services: ServiceFigures[];
  }[];
  assigned_totals: ServiceFigures[];
  unassigned: ServiceFigures[];
  business_services: ServiceFigures[];
  unallocated_cost_count: number;
  unsupported_revenue_count: number;
  unresolved_adjustment_count: number;
  invalid_assignment_count: number;
  assignment_review: {
    expense_id: string;
    vendor?: string | null;
    expense_date?: string;
  }[];
};
