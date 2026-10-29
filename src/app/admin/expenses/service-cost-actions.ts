"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { serviceCostValues } from "@/lib/service-profitability";
export async function saveServiceCost(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_service_cost_allocation",
      serviceCostValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Cost split could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. Reporting uses the current reviewed split; charges and payments are unchanged.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save cost split.",
    };
  }
}
