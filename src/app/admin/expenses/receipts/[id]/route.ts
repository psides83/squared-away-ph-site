import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return new NextResponse("Receipt not found", { status: 404 });
  const { data, error } = await db
    .from("expense_receipts")
    .select("object_path,file_name")
    .eq("id", id)
    .single();
  if (error || !data)
    return new NextResponse("Receipt not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const { data: link, error: sign } = await db.storage
    .from("expense-receipts")
    .createSignedUrl(data.object_path, 60, { download: data.file_name });
  if (sign || !link)
    return new NextResponse("Receipt unavailable", { status: 503 });
  return NextResponse.redirect(link.signedUrl, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
