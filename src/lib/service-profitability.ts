import { cents, dateValue, identifier, text } from "./validation.ts";
export function serviceCostValues(f: FormData) {
  const clear = f.get("clear") === "yes";
  return {
    p_request: identifier(f, "request_id", true),
    p_expense: identifier(f, "expense_id", true),
    p_current: identifier(f, "current"),
    p_training: clear ? 0 : cents(f, "training"),
    p_board: clear ? 0 : cents(f, "board"),
    p_other: clear ? 0 : cents(f, "other"),
    p_from: dateValue(f, "from", true),
    p_to: dateValue(f, "to", true),
    p_reason: text(f, "reason", true, 2000),
    p_clear: clear,
  };
}
export type ServiceCost = {
  id: string;
  source_cents: number;
  training_cents: number;
  board_cents: number;
  other_cents: number;
  covered_from: string;
  covered_to: string;
  reason: string;
  cleared: boolean;
};
export type ServiceProfitability = {
  invalid_assignment_count?: number;
  assignment_review?: {
    expense_id: string;
    vendor?: string | null;
    expense_date?: string;
  }[];
  services: {
    service: string;
    gross_cents: number;
    adjustment_cents: number;
    draft_cents: number;
    cost_cents: number;
  }[];
  other_cost_cents: number;
  unallocated_cost_cents: number;
  unallocated_cost_count: number;
  unsupported_revenue_count: number;
  unresolved_adjustment_count: number;
  cost_review: {
    expense_id: string;
    vendor: string | null;
    eligible_cents: number;
  }[];
  revenue_review: {
    id: string;
    invoice_id: string;
    invoice_number: number | null;
    description: string;
  }[];
  adjustment_review: {
    id: string;
    invoice_id: string;
    invoice_number: number | null;
  }[];
};
