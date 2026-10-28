"use server";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { preparedReceipt } from "@/lib/receipt-storage";
import { identifier } from "@/lib/validation";
import {
  ocrPhotoLimit,
  parseReceiptText,
  receiptOcrConfigured,
  type ReceiptOcrSuggestion,
} from "@/lib/receipt-ocr";
import { readReceiptPhoto } from "@/lib/receipt-ocr-provider";
export type ReceiptOcrResult = {
  error?: string;
  id?: string;
  text?: string;
  suggestion?: ReceiptOcrSuggestion;
};
export async function recognizeReceipt(
  form: FormData,
): Promise<ReceiptOcrResult> {
  const { db } = await requireAdmin();
  let request: string | null = null,
    token: string | undefined;
  const service = receiptOcrConfigured(process.env)
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        (process.env.SUPABASE_SECRET_KEY ||
          process.env.SUPABASE_SERVICE_ROLE_KEY)!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      )
    : null;
  try {
    if (!service)
      throw Error(
        "Free receipt reading needs production setup. Manual entry is available.",
      );
    request = identifier(form, "request_id", true);
    const photo = await preparedReceipt(form.get("receipt"));
    if (
      !photo ||
      photo.bytes.length > ocrPhotoLimit ||
      photo.type.mime === "application/pdf"
    )
      throw Error(
        "Choose a JPEG, PNG or WebP receipt photo up to 900 KB. PDFs remain available for manual attachment.",
      );
    const hash = createHash("sha256").update(photo.bytes).digest("hex");
    const reserved = await db
      .rpc("reserve_receipt_ocr", { p_request: request, p_hash: hash })
      .abortSignal(AbortSignal.timeout(5000));
    if (reserved.error)
      throw Error(
        reserved.error.code === "P0001"
          ? reserved.error.message
          : "Receipt read could not start. Check the latest migration.",
      );
    const job = reserved.data as {
      send: boolean;
      state: string;
      token?: string;
      text?: string;
    };
    if (!job.send) {
      if (job.state === "complete" && job.text)
        return {
          id: request!,
          text: job.text,
          suggestion: parseReceiptText(job.text),
        };
      throw Error(
        "This read is pending, failed or expired. Wait a minute before explicitly starting a new read, or enter manually.",
      );
    }
    token = job.token;
    const text = await readReceiptPhoto(
      photo.bytes,
      process.env.OCR_SPACE_API_KEY!,
    );
    const finished = await service
      .rpc("finish_receipt_ocr", {
        p_request: request,
        p_token: token,
        p_text: text,
      })
      .abortSignal(AbortSignal.timeout(5000));
    if (finished.error)
      throw Error(
        "The receipt read could not be retained. No purchase was saved; enter manually or try later.",
      );
    return { id: request!, text, suggestion: parseReceiptText(text) };
  } catch (error) {
    if (service && request && token)
      try {
        await service
          .rpc("finish_receipt_ocr", {
            p_request: request,
            p_token: token,
            p_text: null,
          })
          .abortSignal(AbortSignal.timeout(5000));
      } catch {}
    return {
      error:
        error instanceof Error
          ? error.message
          : "Receipt reading failed. Manual entry is still available.",
    };
  }
}
