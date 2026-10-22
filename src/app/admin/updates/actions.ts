"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, dateValue, text } from "@/lib/validation";
export async function saveCustomerUpdate(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let saved: string | null = null;
  try {
    const result = await db.rpc("save_horse_update", {
      p_request: identifier(form, "request_id", true),
      p_id: identifier(form, "id"),
      p_horse: identifier(form, "horse_id", true),
      p_date: dateValue(form, "update_date", true),
      p_title: text(form, "title", true, 200),
      p_body: text(form, "body", true, 10000),
    });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Update could not be saved. Confirm the latest migration.",
      );
    saved = result.data;
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to save update.";
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/portal", "layout");
  redirect(
    `/admin/updates?${issue ? `error=${encodeURIComponent(issue)}` : `edit=${saved}&success=Draft+saved.+Review+and+publish+when+ready.`}`,
  );
}
export async function changeCustomerUpdate(action: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let id: string | null = null;
  try {
    id = identifier(form, "id", true);
    const result = await db.rpc("change_horse_update", {
      p_id: id,
      p_action: action,
      p_reason: text(form, "reason", true, 2000),
    });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Update status could not be changed.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to change update.";
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/portal", "layout");
  redirect(
    `/admin/updates?${id ? `edit=${id}&` : ""}${issue ? `error=${encodeURIComponent(issue)}` : "success=Update+status+changed."}`,
  );
}
