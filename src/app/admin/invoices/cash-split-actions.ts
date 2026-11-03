"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { cashSplitValues } from "@/lib/invoice-cash-splits";
export async function saveCashSplit(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_invoice_cash_split",
      cashSplitValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Cash allocation could not save. Check the latest database migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Cash allocation processed. Customer charges, payments and service-date profit records are unchanged.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save cash allocation.",
    };
  }
}
