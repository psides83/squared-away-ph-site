"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { otherIncomePeriodValues } from "@/lib/other-income";
export async function saveOtherIncomePeriod(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_other_income_period",
      otherIncomePeriodValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "The income period could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. The comparison uses the current reviewed period; invoice totals and payments are unchanged.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not save the income period.",
    };
  }
}
