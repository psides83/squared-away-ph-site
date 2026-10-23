"use server";
import { requireAdmin } from "@/lib/auth";
import { identifier, text, choice } from "@/lib/validation";
import { videoSize, resumableEndpoint } from "@/lib/horse-video";
import { revalidatePath } from "next/cache";
export async function prepareVideo(form: FormData) {
  const { db } = await requireAdmin();
  try {
    const id = identifier(form, "upload_id", true)!;
    const size = videoSize(Number(form.get("size")));
    const result = await db.rpc("prepare_horse_video", {
      p_id: id,
      p_horse: identifier(form, "horse_id", true),
      p_title: text(form, "title", true, 200),
      p_name: text(form, "file_name", true, 200),
      p_type: choice(form, "content_type", [
        "video/mp4",
        "video/quicktime",
        "video/webm",
      ]),
      p_size: size,
    });
    if (result.error)
      throw Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Video could not be prepared. Check the latest migration.",
      );
    const existing = await db.storage.from("horse-videos").exists(result.data);
    if (existing.error)
      throw Error(
        "Video storage could not be checked. Retry when the connection is available.",
      );
    if (existing.data) {
      const finish = await db.rpc("finish_horse_video", { p_id: id });
      if (finish.error)
        throw Error(
          "The uploaded object could not be verified. Start over or review the prepared upload.",
        );
      return { ok: true as const, attached: true as const, id };
    }
    const link = await db.storage
      .from("horse-videos")
      .createSignedUploadUrl(result.data, { upsert: false });
    if (link.error || !link.data)
      throw Error(
        "Video storage is not ready. Check the private video bucket setup.",
      );
    return {
      ok: true as const,
      attached: false as const,
      id,
      path: result.data as string,
      token: link.data.token,
      endpoint: resumableEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL!),
    };
  } catch (e) {
    return {
      ok: false as const,
      error:
        e instanceof Error ? e.message : "Video upload could not be prepared.",
    };
  }
}
export async function finishVideo(id: string) {
  const { db } = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return { ok: false as const, error: "Invalid upload." };
  const result = await db.rpc("finish_horse_video", { p_id: id });
  if (result.error)
    return {
      ok: false as const,
      error:
        result.error.code === "P0001"
          ? result.error.message
          : "Video uploaded but could not attach. Keep this editor open and retry saving.",
    };
  revalidatePath("/admin/files");
  return { ok: true as const };
}
