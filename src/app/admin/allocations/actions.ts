"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { allocationValues } from "@/lib/allocations";
import { identifier, text } from "@/lib/validation";

export async function saveAllocation(form: FormData) {
  const { db } = await requireAdmin();
  let expense: string | null = null;
  let error: string | undefined;
  try {
    const values = allocationValues(form);
    expense = values.p_expense;
    const result = await db.rpc("save_expense_allocation", values);
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "The allocation could not be saved. Check the latest migration and reload the expense.",
      );
  } catch (e) {
    error = e instanceof Error ? e.message : "Unable to save allocation.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/allocations?${expense ? `expense=${expense}&` : ""}${error ? `error=${encodeURIComponent(error)}` : "success=Allocation+saved.+Business+expense+totals+are+unchanged."}`,
  );
}
export async function clearAllocation(form: FormData) {
  const { db } = await requireAdmin();
  let expense: string | null = null;
  let error: string | undefined;
  try {
    expense = identifier(form, "expense_id", true);
    const result = await db.rpc("clear_expense_allocation", {
      p_expense: expense,
      p_reason: text(form, "reason", true, 2000),
    });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Unable to clear allocation.",
      );
  } catch (e) {
    error = e instanceof Error ? e.message : "Unable to clear allocation.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/allocations?${expense ? `expense=${expense}&` : ""}${error ? `error=${encodeURIComponent(error)}` : "success=Allocation+cleared.+History+retained."}`,
  );
}
