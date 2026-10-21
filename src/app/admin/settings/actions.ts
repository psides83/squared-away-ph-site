"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  businessSettingsValues,
  type SettingsActionState,
} from "@/lib/business-settings";

export async function saveBusinessSettings(
  _previous: SettingsActionState,
  form: FormData,
): Promise<SettingsActionState> {
  const { db } = await requireAdmin();
  let values;
  try {
    values = businessSettingsValues(form);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Check your settings and try again.",
    };
  }
  const { error } = await db
    .from("business_settings")
    .upsert({ singleton: true, ...values }, { onConflict: "singleton" })
    .select("singleton")
    .single();
  if (error)
    return {
      error:
        "Settings could not be saved. Confirm the latest database migration has completed, then try again.",
    };
  revalidatePath("/admin", "layout");
  return {
    success:
      "Settings saved. Updated defaults apply to new training stays; existing agreements are unchanged.",
  };
}
