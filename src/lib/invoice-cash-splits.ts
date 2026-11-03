import { identifier, text } from "./validation.ts";
export type CashSplitLine = {
  horse_id: string;
  stay_id: string | null;
  amount_cents: number;
  horse_name: string;
  stay_label: string | null;
};
export type CashSplit = {
  id: string;
  source_token: string;
  basis_cents: number;
  reason: string;
  cleared: boolean;
  retired_at: string | null;
  valid?: boolean;
  lines: CashSplitLine[];
};
export type CashSplitOptions = {
  invoice_id: string;
  source: {
    customer_id: string;
    total_cents: number;
    source_token: string;
  } | null;
  current: CashSplit | null;
  history: CashSplit[];
  horses: { id: string; barn_name: string }[];
  stays: {
    id: string;
    horse_id: string;
    billing_customer_id: string;
    arrival_date: string;
    departure_date: string | null;
  }[];
  options_truncated: boolean;
};
export function cashSplitValues(f: FormData) {
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Reopen the current cash allocation editor.");
  const clear = f.get("clear") === "yes";
  let rows: unknown;
  try {
    rows = JSON.parse(text(f, "rows", true, 15000)!);
  } catch {
    throw Error("Reopen the cash allocation rows.");
  }
  if (
    !Array.isArray(rows) ||
    rows.length > (clear ? 0 : 50) ||
    (!clear && !rows.length)
  )
    throw Error("Enter one to fifty positive allocations, or clear the split.");
  const normalized = rows.map((r) => {
    if (
      !r ||
      typeof r !== "object" ||
      !Number.isSafeInteger(r.amount_cents) ||
      r.amount_cents < 1 ||
      r.amount_cents > 1000000000
    )
      throw Error("Enter positive whole-cent amounts.");
    const one = new FormData();
    one.set("horse_id", r.horse_id ?? "");
    one.set("stay_id", r.stay_id ?? "");
    return {
      horse_id: identifier(one, "horse_id", true),
      stay_id: identifier(one, "stay_id"),
      amount_cents: r.amount_cents,
    };
  });
  if (
    new Set(normalized.map((r) => `${r.horse_id}:${r.stay_id ?? ""}`)).size !==
    normalized.length
  )
    throw Error("Assign each horse/stay combination once.");
  return {
    p_request: identifier(f, "request_id", true),
    p_invoice: identifier(f, "invoice_id", true),
    p_current: identifier(f, "current"),
    p_token: token,
    p_rows: normalized,
    p_reason: text(f, "reason", true, 2000),
    p_clear: clear,
  };
}
