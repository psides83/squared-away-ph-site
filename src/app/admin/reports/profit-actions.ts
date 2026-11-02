"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { profitReviewValues } from "@/lib/business-profit";
export async function saveProfitReview(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_profit_inventory_review",
      profitReviewValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "The financial review could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Review processed. Profit uses the current valid review; stock, refunds, credits and cash records are unchanged.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not save the financial review.",
    };
  }
}
