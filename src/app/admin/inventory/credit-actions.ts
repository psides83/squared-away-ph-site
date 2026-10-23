"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, cents, dateValue, choice } from "@/lib/validation";
import { revalidatePath } from "next/cache";
export type CreditState = { error?: string; success?: string };
export async function supplierCreditAction(
  previous: CreditState,
  form: FormData,
): Promise<CreditState> {
  const { db } = await requireAdmin();
  try {
    const operation = choice(form, "operation", [
      "issue",
      "apply",
      "cancel",
      "reverse",
    ]);
    let result;
    if (operation === "issue")
      result = await db.rpc("issue_supplier_credit", {
        p_request: identifier(form, "request_id", true),
        p_vendor: text(form, "vendor", true, 200),
        p_date: dateValue(form, "issued_on", true),
        p_amount: cents(form, "amount"),
        p_reference: text(form, "reference", false, 200),
        p_reason: text(form, "reason", true, 2000),
        p_return: identifier(form, "return_id"),
      });
    else if (operation === "apply")
      result = await db.rpc("apply_supplier_credit", {
        p_request: identifier(form, "request_id", true),
        p_credit: identifier(form, "credit_id", true),
        p_expense: identifier(form, "expense_id", true),
        p_amount: cents(form, "amount"),
        p_date: dateValue(form, "applied_on", true),
      });
    else if (operation === "cancel")
      result = await db.rpc("cancel_supplier_credit", {
        p_credit: identifier(form, "id", true),
        p_reason: text(form, "reason", true, 2000),
      });
    else
      result = await db.rpc("reverse_supplier_credit_application", {
        p_application: identifier(form, "id", true),
        p_reason: text(form, "reason", true, 2000),
      });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Could not save. Check the values and latest database migration.",
      );
    revalidatePath("/admin", "layout");
    if (operation === "issue") {
      const { data: record } = await db
        .from("supplier_credits")
        .select("cancelled_at")
        .eq("id", result.data)
        .maybeSingle();
      if (record?.cancelled_at)
        return {
          success:
            "This credit was already cancelled. No new balance was created.",
        };
    }
    if (operation === "apply") {
      const { data: record } = await db
        .from("supplier_credit_applications")
        .select("reversed_at")
        .eq("id", result.data)
        .maybeSingle();
      if (record?.reversed_at)
        return {
          success:
            "This application was already reversed. Credit was not applied again.",
        };
    }
    return {
      success:
        operation === "issue"
          ? "Supplier credit recorded. No cash refund was assumed."
          : operation === "apply"
            ? "Credit applied. Feed value is unchanged; the purchase cash portion is reduced."
            : "Correction recorded. Review the updated credit balance and purchase cash portion.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not save supplier credit. Your entries have been kept.",
    };
  }
}
