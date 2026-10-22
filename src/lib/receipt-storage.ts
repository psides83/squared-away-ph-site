import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { receiptType, receiptLimit } from "./inventory.ts";
export async function preparedReceipt(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || !file.size) return null;
  if (file.size > receiptLimit) throw new Error("Select a receipt up to 3 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, type: receiptType(bytes), name: file.name };
}
export async function attachReceipt(
  db: SupabaseClient,
  expense: string,
  receipt: NonNullable<Awaited<ReturnType<typeof preparedReceipt>>>,
) {
  const { bytes, type, name } = receipt;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `${expense}/${hash}.${type.extension}`;
  const existing = await db
    .from("expense_receipts")
    .select("id")
    .eq("object_path", path)
    .maybeSingle();
  if (existing.error)
    throw new Error(
      "Receipt records could not load. The expense is saved; attach its receipt from Expenses.",
    );
  if (existing.data) return;
  const { error: upload } = await db.storage
    .from("expense-receipts")
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (upload) {
    const repeated = await db
      .from("expense_receipts")
      .select("id")
      .eq("object_path", path)
      .maybeSingle();
    if (repeated.data) return;
    throw new Error(
      "Receipt upload failed. The expense is saved; attach its receipt from Expenses without re-entering the purchase.",
    );
  }
  const { error: metadata } = await db.from("expense_receipts").insert({
    expense_id: expense,
    object_path: path,
    file_name: name.slice(0, 200) || `receipt.${type.extension}`,
    content_type: type.mime,
    size_bytes: bytes.length,
  });
  if (metadata) {
    await db.storage.from("expense-receipts").remove([path]);
    throw new Error(
      "Receipt could not be attached. The expense is saved; attach its receipt from Expenses.",
    );
  }
}
