"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, cents, dateValue } from "@/lib/validation";
import { quantity } from "@/lib/inventory";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function supplierReturnAction(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let id: string | null = null;
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(form.get("page")) || 1)),
  );
  try {
    let rpc: string;
    let args: Record<string, unknown>;
    if (operation === "return") {
      id = identifier(form, "request_id", true);
      rpc = "record_supplier_return";
      args = {
        p_request: id,
        p_product: identifier(form, "product_id", true),
        p_unit: identifier(form, "unit_id", true),
        p_quantity: quantity(form),
        p_date: dateValue(form, "returned_on", true),
        p_vendor: text(form, "vendor", true, 200),
        p_reason: text(form, "reason", true, 2000),
      };
    } else if (operation === "refund") {
      id = identifier(form, "return_id", true);
      rpc = "record_supplier_refund";
      args = {
        p_request: identifier(form, "request_id", true),
        p_return: id,
        p_amount: cents(form, "amount"),
        p_date: dateValue(form, "paid_on", true),
        p_reference: text(form, "reference", false, 200),
        p_notes: text(form, "notes", false, 2000),
      };
    } else if (operation === "reverse-refund") {
      id = identifier(form, "return_id", true);
      rpc = "reverse_supplier_refund";
      args = {
        p_refund: identifier(form, "refund_id", true),
        p_reason: text(form, "reason", true, 2000),
      };
    } else if (operation === "cancel") {
      id = identifier(form, "return_id", true);
      rpc = "cancel_supplier_return";
      args = { p_return: id, p_reason: text(form, "reason", true, 2000) };
    } else throw new Error("Choose a return action.");
    const result = await db.rpc(rpc, args);
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Could not save this return record. Refresh and try again.",
      );
  } catch (e) {
    issue =
      e instanceof Error ? e.message : "Could not save this return record.";
  }
  revalidatePath("/admin", "layout");
  const refundPage =
    operation === "reverse-refund"
      ? Math.max(
          1,
          Math.min(10000, Math.floor(Number(form.get("refund_page")) || 1)),
        )
      : 1;
  redirect(
    `/admin/inventory/returns?${id ? `return=${id}&refund_page=${refundPage}` : `page=${page}`}&${issue ? `error=${encodeURIComponent(issue)}` : "success=Return+records+updated."}${id ? `#return-${id}` : ""}`,
  );
}
