"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { trainingDayValues } from "@/lib/billing-days";
export async function classifyDays(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let changed = 0;
  const query = new URLSearchParams();
  try {
    const values = trainingDayValues(form);
    query.set("stay", values.p_stay!);
    query.set("month", values.p_from.slice(0, 7));
    const { data, error } = await db.rpc("set_training_days", values);
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Billing days could not be saved. Confirm the latest migration has completed.",
      );
    changed = Number(data);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Billing days could not be saved.";
  }
  if (issue) query.set("error", issue);
  else
    query.set(
      "success",
      `${changed} day${changed === 1 ? "" : "s"} updated. No invoice or charge was created.`,
    );
  revalidatePath("/admin", "layout");
  redirect(`/admin/calendar?${query}`);
}
