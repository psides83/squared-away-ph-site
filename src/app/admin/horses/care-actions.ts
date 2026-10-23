"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, dateValue, choice } from "@/lib/validation";
import { careKinds } from "@/lib/horse-care";
export async function careAction(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  const horse = identifier(form, "horse_id", true);
  let issue: string | undefined;
  try {
    const revision = Number(form.get("revision"));
    if (!Number.isInteger(revision) || revision < 0)
      throw Error("Reload the care record before continuing.");
    const result =
      operation === "save"
        ? await db.rpc("save_horse_care", {
            p_request: identifier(form, "request_id", true),
            p_id: identifier(form, "id"),
            p_revision: revision,
            p_data: {
              horse_id: horse,
              care_date: dateValue(form, "care_date", true),
              kind: choice(form, "kind", Object.keys(careKinds)),
              title: text(form, "title", true, 200),
              provider: text(form, "provider", false, 200),
              notes: text(form, "notes", true, 5000),
              private_notes: text(form, "private_notes", false, 5000),
            },
          })
        : await db.rpc("change_horse_care", {
            p_request: identifier(form, "request_id", true),
            p_id: identifier(form, "id", true),
            p_revision: revision,
            p_action: choice(form, "operation", [
              "share",
              "unshare",
              "archive",
              "restore",
            ]),
            p_reason: text(form, "reason", true, 2000),
          });
    if (result.error)
      throw Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Care record could not save. Check the fields and latest migration.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Care record could not save.";
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/portal/horses");
  redirect(
    `/admin/horses/${horse}?${issue ? `error=${encodeURIComponent(issue)}` : "success=Care+record+updated."}#horse-care`,
  );
}
