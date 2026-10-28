"use server";
import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { identifier, text } from "@/lib/validation";
import { validateVideoPreview, videoPreviewLimit } from "@/lib/video-preview";
import { revalidatePath } from "next/cache";
type PreviewResult = { ok: boolean; error?: string };
export async function saveVideoPreview(form: FormData): Promise<PreviewResult> {
  return persistVideoPreview(form, false);
}
export async function replaceVideoPreview(
  form: FormData,
): Promise<PreviewResult> {
  return persistVideoPreview(form, true);
}
async function persistVideoPreview(
  form: FormData,
  replace: boolean,
): Promise<PreviewResult> {
  const { db } = await requireAdmin();
  try {
    const id = identifier(form, "file_id", true)!;
    const request = replace ? identifier(form, "request", true) : null;
    const expected = replace ? text(form, "expected_hash", true, 64) : null;
    if (replace && !/^[0-9a-f]{64}$/.test(expected ?? ""))
      return {
        ok: false,
        error: "Reopen the preview editor before replacing this image.",
      };
    const image = form.get("preview");
    if (
      !(image instanceof File) ||
      image.size < 1 ||
      image.size > videoPreviewLimit
    )
      return { ok: false };
    const bytes = new Uint8Array(await image.arrayBuffer());
    validateVideoPreview(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const [file, existing] = await Promise.all([
      db
        .from("horse_files")
        .select("horse_id,kind,archived_at")
        .eq("id", id)
        .maybeSingle(),
      db
        .from("horse_video_previews")
        .select("file_id")
        .eq("file_id", id)
        .maybeSingle(),
    ]);
    if (
      file.error ||
      existing.error ||
      !file.data ||
      file.data.kind !== "video" ||
      file.data.archived_at
    )
      return { ok: false };
    if (!replace && existing.data) return { ok: true };
    if (replace && !existing.data)
      return {
        ok: false,
        error:
          "No saved preview was found. Reopen the video before creating one.",
      };
    const path = `${file.data.horse_id}/${id}/${hash}.jpg`;
    const stored = await db.storage.from("horse-video-previews").exists(path);
    if (stored.error) return { ok: false };
    if (!stored.data) {
      const upload = await db.storage
        .from("horse-video-previews")
        .upload(path, bytes, {
          contentType: "image/jpeg",
          cacheControl: "0",
          upsert: false,
        });
      if (upload.error) {
        const retry = await db.storage
          .from("horse-video-previews")
          .exists(path);
        if (retry.error || !retry.data) return { ok: false };
      }
    }
    const attached = replace
      ? await db.rpc("replace_video_preview", {
          p_request: request,
          p_file: id,
          p_expected: expected,
          p_hash: hash,
          p_size: bytes.length,
        })
      : await db.rpc("attach_video_preview", {
          p_file: id,
          p_hash: hash,
          p_size: bytes.length,
        });
    if (attached.error)
      return {
        ok: false,
        error:
          attached.error.code === "P0001" ? attached.error.message : undefined,
      };
    revalidatePath("/admin/files");
    revalidatePath("/portal/files");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
