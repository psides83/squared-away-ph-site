"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { manualServicePeriodValues } from "@/lib/manual-service-periods";
export async function saveManualServicePeriod(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_manual_package_period",
      manualServicePeriodValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "The service period could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. The comparison uses the current reviewed period; invoice totals and payments are unchanged.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not save the service period.",
    };
  }
}
