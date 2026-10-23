import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await requireAdmin();
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return new NextResponse("Document not found", { status: 404, headers });
  const { data, error } = await db
    .from("supplier_return_documents")
    .select("object_path,file_name")
    .eq("id", id)
    .single();
  if (error || !data)
    return new NextResponse("Document not found", { status: 404, headers });
  const { data: link, error: unavailable } = await db.storage
    .from("supplier-return-documents")
    .createSignedUrl(data.object_path, 60, { download: data.file_name });
  if (unavailable || !link)
    return new NextResponse("Document unavailable. Try again.", {
      status: 503,
      headers,
    });
  return NextResponse.redirect(link.signedUrl, { headers });
}
