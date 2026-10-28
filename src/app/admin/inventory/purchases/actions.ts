"use server";
import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { preparedReceipt, attachReceipt } from "@/lib/receipt-storage";
import { receiptPurchaseValues } from "@/lib/receipt-purchase";
import { identifier, text } from "@/lib/validation";
export type ReceiptPurchaseState = {
  error?: string;
  success?: string;
  expense?: string;
  attachmentError?: string;
};
export async function saveReceiptPurchase(
  _state: ReceiptPurchaseState,
  form: FormData,
): Promise<ReceiptPurchaseState> {
  const { db } = await requireAdmin();
  try {
    const values = receiptPurchaseValues(form);
    const receipt = await preparedReceipt(form.get("receipt"));
    const scan = identifier(form, "ocr_read_id");
    if (scan && !receipt)
      throw Error(
        "Keep the read receipt photo attached, or clear reading provenance and enter manually.",
      );
    const header = {
      ...values.p_header,
      ...(scan && receipt
        ? {
            receipt_sha256: createHash("sha256")
              .update(receipt.bytes)
              .digest("hex"),
          }
        : {}),
    };
    const { data, error } = await db.rpc("record_receipt_purchase", {
      ...values,
      p_header: header,
    });
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Receipt purchase could not save. Check the values and latest migration.",
      );
    let attachmentError: string | undefined;
    if (receipt)
      try {
        await attachReceipt(db, data, receipt);
      } catch (error) {
        attachmentError =
          error instanceof Error
            ? error.message
            : "Purchase saved; attach its receipt from the expense record.";
      }
    revalidatePath("/admin", "layout");
    return {
      expense: data,
      success:
        "Receipt request processed. Review the saved record; retrying a cancelled receipt never restores stock.",
      attachmentError,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save receipt purchase.",
    };
  }
}
export async function cancelReceiptPurchase(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc("cancel_receipt_purchase", {
      p_id: identifier(form, "expense_id", true),
      p_reason: text(form, "reason", true, 2000),
    });
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Receipt could not be cancelled. Review linked billing and supplier credits.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Receipt cancelled. Its expense, items and receipt attachment remain in history.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not cancel receipt.",
    };
  }
}
