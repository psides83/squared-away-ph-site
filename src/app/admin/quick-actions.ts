"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier } from "@/lib/validation";
import { trainingEntryValues } from "@/lib/training-entry";
export type QuickTrainingState = { error?: string; success?: string };
export async function logQuickTraining(
  previous: QuickTrainingState,
  form: FormData,
): Promise<QuickTrainingState> {
  const { db } = await requireAdmin();
  try {
    const horses = form.getAll("horse_id").map((value) => {
      const row = new FormData();
      row.set("horse_id", value);
      return identifier(row, "horse_id", true)!;
    });
    if (!horses.length || horses.length > 100)
      throw new Error("Select between 1 and 100 horses.");
    const values = trainingEntryValues(form);
    const { error } = await db.rpc("log_training_batch", {
      p_request: identifier(form, "request_id", true),
      p_horses: horses,
      p_date: values.entry_date,
      p_title: values.title,
      p_notes: values.notes,
      p_duration: values.duration_minutes,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin", "layout");
    return {
      success: `Training saved for ${horses.length} ${horses.length === 1 ? "horse" : "horses"}. Close this form to start another session.`,
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not save training. Your entries have been kept.",
    };
  }
}
