"use server";
import { requireAdmin } from "@/lib/auth";
import { choice, identifier, text } from "@/lib/validation";
import { creditRefundValues } from "@/lib/credit-refunds";
import { revalidatePath } from "next/cache";
export async function creditRefundAction(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const operation = choice(form, "operation", ["record", "reverse"]);
    const result =
      operation === "record"
        ? await db.rpc(
            "record_customer_credit_refund",
            creditRefundValues(form),
          )
        : await db.rpc("reverse_customer_credit_refund", {
            p_refund: identifier(form, "refund_id", true),
            p_reason: text(form, "correction_reason", true, 2000),
          });
    if (result.error)
      throw Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Credit refund could not be saved. Check the latest migration and try again.",
      );
    let success =
      "Correction saved. Available credit and the original cash-report period are restored. No money moved.";
    if (operation === "record") {
      const saved = await db
        .from("customer_credit_refunds")
        .select("reversed_at")
        .eq("id", result.data)
        .maybeSingle();
      success =
        saved.error || !saved.data
          ? "Refund request processed. Review the history before recording another refund."
          : saved.data.reversed_at
            ? "This refund was already reversed. Retrying did not recreate it."
            : "Completed refund recorded. No money was sent by the app.";
    }
    revalidatePath("/admin", "layout");
    revalidatePath("/portal", "layout");
    return { success };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Credit refund could not be saved.",
    };
  }
}
