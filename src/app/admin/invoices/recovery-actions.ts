"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, choice } from "@/lib/validation";
import { recoveryAssignmentValues } from "@/lib/recovery-assignment";
export async function recoveryAssignmentAction(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const operation = choice(form, "operation", ["save", "clear"]);
    let result;
    if (operation === "clear")
      result = await db.rpc("clear_expense_payment", {
        p_id: identifier(form, "current", true),
        p_reason: text(form, "reason", true, 2000),
      });
    else {
      const parsed = recoveryAssignmentValues(form);
      result =
        parsed.kind === "credit"
          ? await db.rpc("assign_expense_credit", {
              ...parsed.values,
              p_application: parsed.source,
            })
          : await db.rpc("assign_expense_payment", {
              ...parsed.values,
              p_payment: parsed.source,
            });
    }
    if (result.error)
      throw Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Recovery assignment could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        operation === "clear"
          ? "Assignment removed. Its history is retained."
          : "Request processed. Review the updated assignments; retrying an old request never recreates a removed assignment.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save recovery assignment.",
    };
  }
}
