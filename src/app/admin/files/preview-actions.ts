"use server";
import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { identifier } from "@/lib/validation";
import { validateVideoPreview, videoPreviewLimit } from "@/lib/video-preview";
import { revalidatePath } from "next/cache";
export async function saveVideoPreview(
  form: FormData,
): Promise<{ ok: boolean }> {
  const { db } = await requireAdmin();
  try {
    const id = identifier(form, "file_id", true)!;
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
    if (existing.data) return { ok: true };
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
    const attached = await db.rpc("attach_video_preview", {
      p_file: id,
      p_hash: hash,
      p_size: bytes.length,
    });
    if (attached.error) return { ok: false };
    revalidatePath("/admin/files");
    revalidatePath("/portal/files");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
