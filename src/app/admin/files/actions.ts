"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, choice } from "@/lib/validation";
import { receiptLimit, receiptType } from "@/lib/inventory";
export async function uploadHorseFile(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const horse = identifier(form, "horse_id", true)!.toLowerCase(),
      title = text(form, "title", true, 200),
      kind = choice(form, "kind", ["photo", "document"]);
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > receiptLimit)
      throw new Error("Choose a JPEG, PNG, WebP, or PDF file up to 3 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      type = receiptType(bytes);
    if (kind === "photo" && type.mime === "application/pdf")
      throw new Error("Choose Document for PDF files.");
    const exists = await db
      .from("horses")
      .select("id")
      .eq("id", horse)
      .single();
    if (exists.error) throw new Error("Horse not found.");
    const id = crypto.randomUUID(),
      path = `${horse}/${id}.${type.extension}`;
    const upload = await db.storage.from("horse-files").upload(path, bytes, {
      contentType: type.mime,
      upsert: false,
      cacheControl: "0",
    });
    if (upload.error)
      throw new Error(
        "File upload failed. Check the horse-files storage migration and try again.",
      );
    const result = await db.rpc("attach_horse_file", {
      p_id: id,
      p_horse: horse,
      p_kind: kind,
      p_title: title,
      p_name:
        file.name.replace(/[\r\n\0]/g, "").slice(0, 200) ||
        `horse-file.${type.extension}`,
      p_path: path,
      p_type: type.mime,
      p_size: bytes.length,
    });
    if (result.error) {
      await db.storage.from("horse-files").remove([path]);
      throw new Error("The upload could not be attached. Try again.");
    }
  } catch (e) {
    issue = e instanceof Error ? e.message : "File could not be uploaded.";
  }
  revalidatePath("/admin/files");
  redirect(
    `/admin/files?${issue ? `error=${encodeURIComponent(issue)}` : "success=Private+file+uploaded.+Review+before+publishing."}`,
  );
}
export async function changeHorseFile(action: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const result =
      action === "rename"
        ? await db.rpc("rename_horse_file", {
            p_id: identifier(form, "id", true),
            p_title: text(form, "title", true, 200),
            p_reason: text(form, "reason", true, 2000),
          })
        : await db.rpc("change_horse_file", {
            p_id: identifier(form, "id", true),
            p_action: action,
            p_reason: text(form, "reason", true, 2000),
          });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "File status could not be changed.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to change file status.";
  }
  revalidatePath("/admin/files");
  revalidatePath("/portal", "layout");
  redirect(
    `/admin/files?${issue ? `error=${encodeURIComponent(issue)}` : "success=File+publication+updated."}`,
  );
}
