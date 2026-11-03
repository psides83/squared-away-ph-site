import { cents, identifier, text, choice } from "./validation.ts";
export type FeedAbsorption = {
  id: string;
  source_token: string;
  mode: "full" | "partial" | "review" | "clear";
  amount_cents: number;
  requested_cents: number | null;
  reason: string;
  retired_at: string | null;
};
export type AbsorptionRow = {
  movement_id: string;
  horse_id: string;
  barn_name: string;
  product_name: string;
  movement_date: string;
  entered_quantity: number;
  unit_label: string;
  cost_cents: number;
  source_token: string;
  claimed: boolean;
  claim_invoice_id?: string | null;
  needs_review: boolean;
  invoice_review_count?: number;
  pending_invoice_ids?: string[];
  absorbed_cents: number;
  current: FeedAbsorption | null;
  history: FeedAbsorption[];
};
export type AbsorptionReport = {
  count: number;
  totals: {
    cost_cents: number;
    absorbed_cents: number;
    review_count: number;
    invoice_review_count?: number;
    supported_unbilled_cents: number;
  };
  rows: AbsorptionRow[];
};
export function feedAbsorptionValues(f: FormData) {
  const mode = choice(f, "mode", ["full", "partial", "review", "clear"]);
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Reopen the current feeding-cost review.");
  const amount = mode === "partial" ? cents(f, "amount") : null;
  if (amount === 0)
    throw Error("Enter a positive partial amount, or clear the designation.");
  return {
    p_request: identifier(f, "request_id", true),
    p_movement: identifier(f, "movement_id", true),
    p_current: identifier(f, "current"),
    p_token: token,
    p_mode: mode,
    p_cents: amount,
    p_reason: text(f, "reason", true, 2000),
    p_invoice_review: f.get("invoice_review_ack") === "yes",
  };
}
