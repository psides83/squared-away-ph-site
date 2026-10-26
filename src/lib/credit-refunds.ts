import { cents, choice, dateValue, identifier, text } from "./validation.ts";
import { paymentMethods } from "./invoices.ts";
export function creditRefundValues(form: FormData) {
  const amount = cents(form, "amount");
  if (amount <= 0) throw Error("Enter a positive amount already returned.");
  return {
    p_request: identifier(form, "request", true),
    p_credit: identifier(form, "credit_id", true),
    p_amount: amount,
    p_date: dateValue(form, "refunded_on", true),
    p_method: choice(form, "method", paymentMethods),
    p_reason: text(form, "reason", true, 500),
    p_reference: text(form, "reference", false, 200),
    p_notes: text(form, "notes", false, 2000),
  };
}
