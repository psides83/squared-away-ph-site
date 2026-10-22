import { cents, identifier, text } from "./validation.ts";
export function costSplitValues(form: FormData) {
  const rows: { stay_id: string; amount_cents: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("amount_")) continue;
    const single = new FormData();
    single.set("stay_id", key.slice(7));
    single.set("amount", value);
    const stay = identifier(single, "stay_id", true)!;
    const amount = cents(single, "amount");
    if (amount > 0) rows.push({ stay_id: stay, amount_cents: amount });
  }
  if (
    !rows.length ||
    rows.length > 1000 ||
    new Set(rows.map((r) => r.stay_id)).size !== rows.length
  )
    throw new Error(
      "Assign a positive amount to each selected stay once, or clear the assignment.",
    );
  return {
    p_request: identifier(form, "request_id", true),
    p_expense: identifier(form, "expense_id", true),
    p_allocation: identifier(form, "allocation_id"),
    p_horse: identifier(form, "horse_id", true),
    p_rows: rows,
    p_reason: text(form, "reason", true, 2000),
  };
}
export function invoiceReportingValues(form: FormData) {
  return {
    p_request: identifier(form, "request_id", true),
    p_invoice: identifier(form, "invoice_id", true),
    p_horse: identifier(form, "horse_id", true),
    p_stay: identifier(form, "stay_id"),
    p_reason: text(form, "reason", true, 2000),
  };
}
