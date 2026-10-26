import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await requireAdmin();
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("File not found", { status: 404, headers });
  const query = new URL(request.url).searchParams;
  if (query.get("preview") === "1") {
    const preview = await db
      .from("horse_video_previews")
      .select("object_path")
      .eq("file_id", id)
      .maybeSingle();
    if (preview.error || !preview.data)
      return new NextResponse("Preview not found", { status: 404, headers });
    const signed = await db.storage
      .from("horse-video-previews")
      .createSignedUrl(preview.data.object_path, 60);
    if (signed.error || !signed.data)
      return new NextResponse("Preview unavailable", { status: 503, headers });
    return NextResponse.redirect(signed.data.signedUrl, { headers });
  }
  const file = await db
    .from("horse_files")
    .select("object_path,file_name,kind")
    .eq("id", id)
    .maybeSingle();
  if (file.error || !file.data)
    return new NextResponse("File not found", { status: 404, headers });
  const download = query.get("download") === "1";
  const link = await db.storage
    .from(file.data.kind === "video" ? "horse-videos" : "horse-files")
    .createSignedUrl(
      file.data.object_path,
      file.data.kind === "video" ? 300 : 60,
      download ? { download: file.data.file_name } : undefined,
    );
  if (link.error || !link.data)
    return new NextResponse("File unavailable", { status: 503, headers });
  return NextResponse.redirect(link.data.signedUrl, { headers });
}
