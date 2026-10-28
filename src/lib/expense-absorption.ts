import { identifier, cents, text } from "./validation.ts";
export function expenseAbsorptionValues(form: FormData) {
  const amount = form.get("remove") === "yes" ? 0 : cents(form, "amount");
  if (form.get("remove") !== "yes" && amount <= 0)
    throw Error("Enter a positive absorbed amount.");
  return {
    p_request: identifier(form, "request_id", true),
    p_current: identifier(form, "current"),
    p_expense: identifier(form, "expense_id", true),
    p_cents: amount,
    p_reason: text(form, "reason", true, 2000),
  };
}
export type ExpenseAbsorption = {
  id: string;
  amount_cents: number;
  reason: string;
  created_at: string;
  retired_at: string | null;
};
