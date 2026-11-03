"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { monthlyServicePeriodValues } from "@/lib/monthly-service-periods";
export async function saveMonthlyServicePeriod(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_monthly_service_period",
      monthlyServicePeriodValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Could not save monthly reporting dates. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Review processed. Reporting uses current valid dates; invoice charges and billing claims are unchanged.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save reporting dates.",
    };
  }
}
