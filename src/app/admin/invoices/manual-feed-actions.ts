"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { manualFeedPeriodValues } from "@/lib/manual-feed-periods";
export async function saveManualFeedPeriod(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_manual_feed_period",
      manualFeedPeriodValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "The feed period could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. The comparison uses the current reviewed period; invoice totals and payments are unchanged.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save the feed period.",
    };
  }
}
