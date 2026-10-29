"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  packageReportingValues,
  adjustmentReportingValues,
} from "@/lib/package-reporting";
export async function savePackageReporting(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_package_reporting",
      packageReportingValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Could not save the reporting split. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Reporting split saved. It applies to newly generated training lines; existing invoices remain unchanged.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save reporting split.",
    };
  }
}
export async function saveAdjustmentReporting(
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc(
      "set_adjustment_reporting",
      adjustmentReportingValues(form),
    );
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Could not save the adjustment allocation. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Manual allocation saved. Customer charges and payments are unchanged.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not save allocation.",
    };
  }
}
