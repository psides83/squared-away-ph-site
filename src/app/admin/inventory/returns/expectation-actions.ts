"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, cents, dateValue } from "@/lib/validation";
import { revalidatePath } from "next/cache";
export async function saveReturnExpectations(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const result = await db.rpc("save_supplier_return_expectations", {
      p_return: identifier(form, "return_id", true),
      p_expected: identifier(form, "expected"),
      p_version: identifier(form, "version", true),
      p_cash: text(form, "cash") === null ? null : cents(form, "cash"),
      p_cash_due: dateValue(form, "cash_due"),
      p_credit: text(form, "credit") === null ? null : cents(form, "credit"),
      p_credit_due: dateValue(form, "credit_due"),
      p_notes: text(form, "notes", false, 2000),
    });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Could not save expectations. Refresh and try again.",
      );
    revalidatePath("/admin/inventory", "layout");
    return {
      success:
        "Expectations saved. No cash refund or store credit was recorded.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not save expectations.",
    };
  }
}
