import { identifier, cents, text } from "./validation.ts";
export function recoveryAssignmentValues(form: FormData) {
  const value = text(form, "payment_id", true, 50)!;
  const credit = value.startsWith("credit:");
  if (value.includes(":") && !credit)
    throw Error("Please select a valid record.");
  const single = new FormData();
  single.set("source_id", credit ? value.slice(7) : value);
  const source = identifier(single, "source_id", true)!;
  const amount = cents(form, "amount");
  if (amount <= 0) throw Error("Enter a positive recovery amount.");
  return {
    kind: credit ? ("credit" as const) : ("payment" as const),
    source,
    values: {
      p_request: identifier(form, "request_id", true),
      p_current: identifier(form, "current"),
      p_expense: identifier(form, "expense_id", true),
      p_cents: amount,
      p_reason: text(form, "reason", true, 2000),
    },
  };
}
