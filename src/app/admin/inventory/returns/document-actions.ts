"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, choice, text } from "@/lib/validation";
import { preparedReceipt } from "@/lib/receipt-storage";
export type ReturnDocumentState = { error?: string; success?: string };
export async function attachReturnDocument(
  previous: ReturnDocumentState,
  form: FormData,
): Promise<ReturnDocumentState> {
  const { db } = await requireAdmin();
  try {
    const returnId = identifier(form, "return_id", true)!;
    const kind = choice(form, "kind", [
      "return_slip",
      "refund_confirmation",
      "other",
    ]);
    const file = await preparedReceipt(form.get("receipt"));
    if (!file) throw new Error("Choose a document first.");
    const hash = createHash("sha256").update(file.bytes).digest("hex");
    const path = `${returnId}/${hash}.${file.type.extension}`;
    const { data: existing, error: lookup } = await db
      .from("supplier_return_documents")
      .select("id,archived_at")
      .eq("return_id", returnId)
      .eq("content_hash", hash)
      .maybeSingle();
    if (lookup)
      throw new Error(
        "Document records could not load. Check the latest migration before retrying.",
      );
    if (existing)
      return {
        success: existing.archived_at
          ? "This file is already in Archived documents. Restore it there instead of uploading it again."
          : "This document is already attached. No duplicate was created.",
      };
    const { data: record, error: missing } = await db
      .from("supplier_returns")
      .select("id")
      .eq("id", returnId)
      .single();
    if (missing || !record) throw new Error("Supplier return not found.");
    const { error: upload } = await db.storage
      .from("supplier-return-documents")
      .upload(path, file.bytes, { contentType: file.type.mime, upsert: false });
    if (upload) {
      // A previous attempt may have saved the file before the metadata request failed.
      const { data: stored, error: unavailable } = await db.storage
        .from("supplier-return-documents")
        .download(path);
      if (
        unavailable ||
        !stored ||
        createHash("sha256")
          .update(new Uint8Array(await stored.arrayBuffer()))
          .digest("hex") !== hash
      )
        throw new Error(
          "The document could not upload. Your return and refund records are unchanged; retry this attachment.",
        );
    }
    const { error } = await db.rpc("register_supplier_return_document", {
      p_return: returnId,
      p_hash: hash,
      p_name: file.name.slice(0, 200) || `document.${file.type.extension}`,
      p_type: file.type.mime,
      p_size: file.bytes.length,
      p_kind: kind,
    });
    if (error) {
      throw new Error(
        "The document could not be attached. Your return and refunds are unchanged; retry this attachment.",
      );
    }
    revalidatePath("/admin", "layout");
    return {
      success:
        "Document attached privately. Return quantities and refund amounts are unchanged.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not attach the document. Retry without entering the return again.",
    };
  }
}
export async function archiveReturnDocument(
  previous: ReturnDocumentState,
  form: FormData,
): Promise<ReturnDocumentState> {
  const { db } = await requireAdmin();
  try {
    const { error } = await db.rpc("set_supplier_return_document_archived", {
      p_document: identifier(form, "document_id", true),
      p_expected: identifier(form, "expected", true),
      p_archived:
        choice(form, "operation", ["archive", "restore"]) === "archive",
      p_reason: text(form, "reason", true, 2000),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin", "layout");
    return {
      success:
        form.get("operation") === "archive"
          ? "Document archived. The file and correction history are retained."
          : "Document restored.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not update this document.",
    };
  }
}
