"use server";
import { requireAdmin } from "@/lib/auth";
import { customerRefundValues } from "@/lib/customer-refunds";
import { identifier, text } from "@/lib/validation";
import { revalidatePath } from "next/cache";
export async function invoiceRefundAction(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const operation = text(form, "operation", true);
    const result =
      operation === "record"
        ? await db.rpc("record_invoice_refund", customerRefundValues(form))
        : operation === "reverse"
          ? await db.rpc("reverse_invoice_refund", {
              p_refund: identifier(form, "refund_id", true),
              p_reason: text(form, "correction_reason", true, 2000),
            })
          : null;
    if (!result) throw new Error("Choose a refund action.");
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "The refund record could not be saved. Refresh and check the latest migration.",
      );
    let recordMessage = "Refund recorded. No money was sent by the app.";
    if (operation === "record") {
      const saved = await db
        .from("invoice_refunds")
        .select("reversed_at")
        .eq("id", result.data)
        .maybeSingle();
      if (saved.error)
        recordMessage =
          "Refund request processed. Review the history before recording another refund.";
      else if (saved.data?.reversed_at)
        recordMessage =
          "This refund was already reversed. Retrying did not recreate it.";
    }
    revalidatePath("/admin", "layout");
    revalidatePath("/portal", "layout");
    return {
      success:
        operation === "record"
          ? recordMessage
          : "Mistaken refund record reversed. History is retained; no money was moved.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Refund record could not be saved.",
    };
  }
}
