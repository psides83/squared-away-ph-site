"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, text } from "@/lib/validation";
import { parseRidingDays } from "@/lib/riding-schedule";
import { revalidatePath } from "next/cache";
export type RidingState = {
  error?: string;
  success?: string;
  version?: string;
};
export async function saveRidingSchedule(
  previous: RidingState,
  form: FormData,
): Promise<RidingState> {
  const { db } = await requireAdmin();
  try {
    const clear = form.get("operation") === "clear";
    const { data, error } = await db.rpc("save_horse_riding_schedule", {
      p_horse: identifier(form, "horse_id", true),
      p_expected: identifier(form, "expected"),
      p_days: clear ? null : parseRidingDays(text(form, "days", true, 300)!),
      p_notes: clear ? null : text(form, "notes", false, 2000),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin", "layout");
    return {
      success: clear
        ? "Riding plan cleared. Actual sessions and billing days are unchanged."
        : "Weekly riding plan saved. Actual sessions and billing days are unchanged.",
      version: data as string,
    };
  } catch (e) {
    return {
      ...previous,
      success: undefined,
      error:
        e instanceof Error
          ? e.message
          : "Could not save the riding plan. Your changes have been kept.",
    };
  }
}
