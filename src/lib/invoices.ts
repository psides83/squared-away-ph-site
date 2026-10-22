import { cents, choice, dateValue, identifier, text } from "./validation.ts";
export const paymentMethods = [
  "cash",
  "check",
  "venmo",
  "apple_cash",
  "paypal",
  "bank_transfer",
  "other",
] as const;
export const paymentMethodLabels: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  apple_cash: "Apple Cash",
  paypal: "PayPal",
  bank_transfer: "Bank transfer",
  other: "Other",
};
export function invoiceHeaderValues(form: FormData) {
  const issue = dateValue(form, "issue_date", true)!;
  const due = dateValue(form, "due_date", true)!;
  if (due < issue)
    throw new Error("Due date must be on or after the invoice date.");
  const from = dateValue(form, "period_from");
  const to = dateValue(form, "period_to");
  if (Boolean(from) !== Boolean(to) || (from && to && from > to))
    throw new Error(
      "Choose both billing period dates in order, or leave both blank.",
    );
  const stay = identifier(form, "stay_id");
  if (stay && (!from || !to))
    throw new Error("Choose a billing period for the training stay.");
  return {
    p_request: identifier(form, "request_id", true),
    p_customer: identifier(form, "customer_id", true),
    p_stay: stay,
    p_issue: issue,
    p_due: due,
    p_from: from,
    p_to: to,
    p_notes: text(form, "notes", false, 5000),
  };
}
export function signedAmount(form: FormData) {
  const value = cents(form, "amount");
  return choice(form, "direction", ["charge", "credit"]) === "credit"
    ? -value
    : value;
}
export function paymentValues(form: FormData) {
  const amount = cents(form, "amount");
  if (amount === 0) throw new Error("Record a positive payment amount.");
  return {
    p_request: identifier(form, "request_id", true),
    p_invoice: identifier(form, "invoice_id", true),
    p_amount: amount,
    p_date: dateValue(form, "paid_on", true),
    p_method: choice(form, "method", paymentMethods),
    p_reference: text(form, "reference", false, 200),
    p_notes: text(form, "notes", false, 2000),
  };
}
export function invoiceStatus(
  row: { status: string; balance_cents: number | string; due_date: string },
  date: string,
) {
  if (row.status === "draft") return "Draft";
  if (row.status === "void") return "Voided";
  if (Number(row.balance_cents) === 0) return "Paid";
  return row.due_date < date ? "Overdue" : "Open";
}
export function securePaymentLink(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
