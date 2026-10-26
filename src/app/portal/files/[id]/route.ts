import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/auth";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await requireCustomer();
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("File not found", { status: 404, headers });
  const query = new URL(request.url).searchParams;
  if (query.get("preview") === "1") {
    const preview = await db.rpc("portal_video_preview", { p_id: id });
    if (preview.error || !preview.data)
      return new NextResponse("Preview not found", { status: 404, headers });
    const signed = await db.storage
      .from("horse-video-previews")
      .createSignedUrl(preview.data, 60);
    if (signed.error || !signed.data)
      return new NextResponse("Preview unavailable", { status: 503, headers });
    return NextResponse.redirect(signed.data.signedUrl, { headers });
  }
  const file = await db.rpc("portal_file", { p_id: id });
  if (file.error || !file.data)
    return new NextResponse("File not found", { status: 404, headers });
  const download = query.get("download") === "1";
  const link = await db.storage
    .from(file.data.kind === "video" ? "horse-videos" : "horse-files")
    .createSignedUrl(
      file.data.path,
      file.data.kind === "video" ? 300 : 60,
      download ? { download: file.data.name } : undefined,
    );
  if (link.error || !link.data)
    return new NextResponse("File unavailable", { status: 503, headers });
  return NextResponse.redirect(link.data.signedUrl, { headers });
}
