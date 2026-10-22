"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, text } from "@/lib/validation";
import { type FeedingTime } from "@/lib/feeding-times";
export type FeedingTimeState = {
  error?: string;
  success?: string;
  operation?: string;
  revision?: string;
  times?: FeedingTime[];
};
export async function manageFeedingTimes(
  previous: FeedingTimeState,
  form: FormData,
): Promise<FeedingTimeState> {
  const { db } = await requireAdmin();
  const operation = form.get("operation");
  try {
    let error;
    if (operation === "create") {
      const result = await db.rpc("create_feeding_times", {
        p_rows: JSON.parse(text(form, "rows", true, 250000)!),
      });
      error = result.error;
    } else if (operation === "edit") {
      const clock = text(form, "time_of_day", false, 8),
        sort = text(form, "sort_order", true, 4)!;
      if (clock && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(clock))
        throw new Error("Enter a valid clock time.");
      if (!/^\d+$/.test(sort) || Number(sort) > 1000)
        throw new Error("Display order must be between 0 and 1000.");
      const result = await db
        .from("feeding_times")
        .update({
          name: text(form, "name", true, 60),
          time_of_day: clock,
          sort_order: Number(sort),
          archived: form.get("archived") === "on",
        })
        .eq("id", identifier(form, "id", true)!)
        .select()
        .single();
      error = result.error;
    } else throw new Error("Choose a feeding time action.");
    if (error)
      throw new Error(
        error.code === "23505"
          ? "A feeding time with this name already exists. Your entries have been kept."
          : error.code === "P0001"
            ? error.message
            : "Could not save. Check the values and latest database migration.",
      );
    const result = await db
      .from("feeding_times")
      .select("*")
      .order("sort_order")
      .order("name");
    revalidatePath("/admin", "layout");
    return {
      success:
        operation === "create"
          ? "All new feeding times saved."
          : "Feeding time updated. Past records are unchanged.",
      operation,
      revision: crypto.randomUUID(),
      times: result.data ?? previous.times,
    };
  } catch (e) {
    return {
      times: previous.times,
      error:
        e instanceof Error
          ? e.message
          : "Could not save. Your entries have been kept.",
    };
  }
}
