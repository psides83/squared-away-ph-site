"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { expenseAbsorptionValues } from "@/lib/expense-absorption";
export async function saveExpenseAbsorption(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_expense_absorption",
      expenseAbsorptionValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Absorbed cost could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. Review the updated amount below. Old requests never restore a removed designation.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save absorbed cost.",
    };
  }
}
