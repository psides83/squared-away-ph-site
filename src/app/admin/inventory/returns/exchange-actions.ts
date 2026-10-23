"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, choice } from "@/lib/validation";
import { revalidatePath } from "next/cache";
export async function supplierExchangeAction(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const operation = choice(form, "operation", ["link", "remove"]);
    const result =
      operation === "link"
        ? await db.rpc("link_supplier_exchange", {
            p_request: identifier(form, "request", true),
            p_return: identifier(form, "return_id", true),
            p_expense: identifier(form, "expense_id", true),
            p_notes: text(form, "notes", false, 2000),
          })
        : await db.rpc("remove_supplier_exchange", {
            p_link: identifier(form, "link_id", true),
            p_reason: text(form, "reason", true, 2000),
          });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Could not save the exchange link. Refresh and try again.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        operation === "link"
          ? "Exchange link saved. Stock, store credit and payments are unchanged."
          : "Exchange link removed; its history is retained. Financial records are unchanged.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save exchange link.",
    };
  }
}
