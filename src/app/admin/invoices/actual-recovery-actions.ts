"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { actualRecoveryValues } from "@/lib/actual-cost-recovery";
export async function recoverActualSources(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "recover_actual_cost_sources",
      actualRecoveryValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Original source links could not be restored. Check the latest database migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Original source links restored. The saved charge is unchanged; these sources are reserved against duplicate billing.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not restore original source links.",
    };
  }
}
