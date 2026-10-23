"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier } from "@/lib/validation";
import { bulkExpenseValues } from "@/lib/bulk-expenses";
import { revalidatePath } from "next/cache";
export type BulkExpenseState = { error?: string; ids?: string[] };
export async function recordBulkExpenses(
  _state: BulkExpenseState,
  form: FormData,
): Promise<BulkExpenseState> {
  const { db } = await requireAdmin();
  try {
    const { data, error } = await db.rpc("record_expense_batch", {
      p_request: identifier(form, "request", true),
      p_rows: bulkExpenseValues(form),
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "No expenses were saved. Check each entry and try again.",
      );
    revalidatePath("/admin", "layout");
    return { ids: data as string[] };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "No expenses were saved.",
    };
  }
}
