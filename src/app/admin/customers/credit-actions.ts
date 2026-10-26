"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, choice, cents, dateValue, text } from "@/lib/validation";
import { paymentMethods } from "@/lib/invoices";
import { revalidatePath } from "next/cache";
export async function customerCreditAction(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const operation = choice(form, "operation", [
      "record",
      "apply",
      "reverse-credit",
      "reverse-application",
    ]);
    let result;
    if (operation === "record") {
      const source = choice(form, "source", ["advance", "invoice"]);
      result = await db.rpc("record_customer_credit", {
        p_request: identifier(form, "request", true),
        p_customer: identifier(form, "customer_id", true),
        p_source: source,
        p_payment:
          source === "invoice" ? identifier(form, "payment_id", true) : null,
        p_amount: cents(form, "amount"),
        p_date: dateValue(form, "date", true),
        p_method:
          source === "advance" ? choice(form, "method", paymentMethods) : null,
        p_reason: text(form, "reason", true, 500),
        p_reference: text(form, "reference", false, 200),
      });
    } else if (operation === "apply")
      result = await db.rpc("apply_customer_credit", {
        p_request: identifier(form, "request", true),
        p_credit: identifier(form, "credit_id", true),
        p_invoice: identifier(form, "invoice_id", true),
        p_amount: cents(form, "amount"),
        p_date: dateValue(form, "date", true),
      });
    else
      result = await db.rpc("reverse_customer_credit", {
        p_id: identifier(form, "record_id", true),
        p_application: operation === "reverse-application",
        p_reason: text(form, "reason", true, 2000),
      });
    if (result.error)
      throw Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Credit could not be saved. Check the latest migration and try again.",
      );
    revalidatePath("/admin", "layout");
    revalidatePath("/portal", "layout");
    return {
      success: operation.startsWith("reverse")
        ? "Correction saved. History is retained; no money moved."
        : "Request processed. Review the updated history. Retrying an earlier request never recreates a reversed record.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Credit could not be saved.",
    };
  }
}
