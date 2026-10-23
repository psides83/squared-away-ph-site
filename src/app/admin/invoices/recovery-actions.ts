"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { identifier, cents, text } from "@/lib/validation";
export async function recoveryAction(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  const invoice = identifier(form, "invoice_id", true);
  try {
    const result =
      operation === "clear"
        ? await db.rpc("clear_expense_payment", {
            p_id: identifier(form, "current", true),
            p_reason: text(form, "reason", true, 2000),
          })
        : await db.rpc("assign_expense_payment", {
            p_request: identifier(form, "request_id", true),
            p_current: identifier(form, "current"),
            p_payment: identifier(form, "payment_id", true),
            p_expense: identifier(form, "expense_id", true),
            p_cents: cents(form, "amount"),
            p_reason: text(form, "reason", true, 2000),
          });
    if (result.error)
      throw Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Payment assignment could not save. Check the latest migration.",
      );
  } catch (e) {
    issue =
      e instanceof Error ? e.message : "Could not save payment assignment.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/invoices/${invoice}?${issue ? `error=${encodeURIComponent(issue)}` : "success=Expense+payment+assignment+saved."}#invoice-payments`,
  );
}
