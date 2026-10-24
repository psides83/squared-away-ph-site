import { cents, choice, dateValue, identifier, text } from "./validation.ts";
import { paymentMethods } from "./invoices.ts";
export function customerRefundValues(form: FormData) {
  return {
    p_request: identifier(form, "request", true),
    p_payment: identifier(form, "payment_id", true),
    p_amount: cents(form, "amount"),
    p_date: dateValue(form, "refunded_on", true),
    p_effect: choice(form, "effect", ["reduce", "reopen"]),
    p_method: choice(form, "method", paymentMethods),
    p_reason: text(form, "reason", true, 500),
    p_reference: text(form, "reference", false, 200),
    p_notes: text(form, "notes", false, 2000),
  };
}
