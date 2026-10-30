"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { packageReviewValues } from "@/lib/package-review";
export async function savePackageReview(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_package_reporting_review",
      packageReviewValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "The reporting review could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Request processed. Review the current reporting split below. Invoice charges and original snapshots are unchanged.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not save reporting review.",
    };
  }
}
