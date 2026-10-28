"use server";
import {
  receiptDuplicateApproval,
  type ReceiptDuplicateReview,
} from "@/lib/receipt-duplicates";
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
  duplicateReview?: ReceiptDuplicateReview;
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
    const prior = await db
      .from("inventory_receipt_purchases")
      .select("id,payload")
      .eq("id", values.p_request)
      .maybeSingle();
    if (prior.error)
      throw Error(
        "Existing receipt requests could not be checked. Please refresh.",
      );
    const digest = receipt
      ? createHash("sha256").update(receipt.bytes).digest("hex")
      : null;
    const approval = receiptDuplicateApproval(form);
    if (approval && !receipt)
      throw Error(
        "Keep the matching receipt file selected while reviewing another purchase.",
      );
    const review = async () => {
      const response = await db.rpc("review_receipt_photo", {
        p_hash: digest,
        p_exclude: values.p_request,
      });
      if (response.error)
        throw Error("Receipt duplicates could not be checked. Please refresh.");
      return response.data as ReceiptDuplicateReview;
    };
    let duplicateReview: ReceiptDuplicateReview | undefined;
    if (digest && !prior.data) {
      duplicateReview = await review();
      if (
        duplicateReview.count > 0 &&
        (!approval || approval.duplicate_review_token !== duplicateReview.token)
      )
        return {
          error:
            "This receipt file is already linked to an expense. Review the matches below before recording another purchase.",
          duplicateReview,
        };
    }
    const header = {
      ...values.p_header,
      // Existing pre-fingerprint requests retain their original payload on retries.
      ...(digest &&
      (!prior.data ||
        Object.hasOwn(prior.data.payload?.header ?? {}, "receipt_sha256"))
        ? { receipt_sha256: digest }
        : {}),
      ...(approval && (prior.data || Number(duplicateReview?.count) > 0)
        ? approval
        : {}),
    };
    const { data, error } = await db.rpc("record_receipt_purchase", {
      ...values,
      p_header: header,
    });
    if (error) {
      if (error.hint === "review_receipt_duplicate" && digest)
        return {
          error:
            "Receipt matches changed. Review the current records before saving.",
          duplicateReview: await review(),
        };
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Receipt purchase could not save. Check the values and latest migration.",
      );
    }
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
