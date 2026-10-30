"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { serviceAssignmentValues } from "@/lib/service-assignments";
export async function saveServiceAssignments(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_service_assignments",
      serviceAssignmentValues(f),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Assignments could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. Review the current assignments below. Bills, payments and cash reports are unchanged.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save assignments.",
    };
  }
}
