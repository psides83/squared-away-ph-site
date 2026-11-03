"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { feedAbsorptionValues } from "@/lib/feed-absorption";
export async function saveFeedAbsorption(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_feed_absorption",
      feedAbsorptionValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Feed billing decision could not save. Check the latest database migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Feed billing decision processed. Full feeding cost remains in profit reports; existing invoice amounts are unchanged.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not save feed billing decision.",
    };
  }
}
