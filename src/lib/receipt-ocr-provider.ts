import { receiptType } from "./inventory.ts";
import { ocrPhotoLimit } from "./receipt-ocr.ts";
export async function readReceiptPhoto(bytes: Uint8Array, key: string) {
  const type = receiptType(bytes);
  if (type.mime === "application/pdf" || bytes.length > ocrPhotoLimit)
    throw Error(
      "Read receipt supports JPEG, PNG or WebP photos up to 900 KB. PDFs can still be attached for manual entry.",
    );
  const body = new FormData();
  body.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: type.mime }),
    `receipt.${type.extension}`,
  );
  body.set("OCREngine", "2");
  body.set("isOverlayRequired", "false");
  body.set("isCreateSearchablePdf", "false");
  body.set("detectOrientation", "true");
  body.set("isTable", "true");
  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: key },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 429
        ? "Free receipt reading is busy or limited. Enter manually or try again later."
        : "The free receipt reader is unavailable. Manual entry is still available.",
    );
  }
  if (!response.body) throw Error("Receipt reader returned no result.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 256000)
        throw Error(
          "Receipt reader result is too large. Enter the receipt manually.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytesOut = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytesOut.set(chunk, offset);
    offset += chunk.length;
  }
  let result;
  try {
    result = JSON.parse(new TextDecoder().decode(bytesOut));
  } catch {
    throw Error(
      "Receipt reader returned an unreadable result. Enter manually.",
    );
  }
  if (
    Number(result.OCRExitCode) !== 1 ||
    result.IsErroredOnProcessing !== false ||
    !Array.isArray(result.ParsedResults) ||
    result.ParsedResults.length !== 1 ||
    Number(result.ParsedResults[0]?.FileParseExitCode) !== 1 ||
    typeof result.ParsedResults[0]?.ParsedText !== "string"
  )
    throw Error(
      "The reader could not finish this photo completely. Partial results were not applied; enter manually or try a clearer photo.",
    );
  const text = result.ParsedResults[0].ParsedText as string;
  if (!text.trim() || text.length > 40000)
    throw Error("Receipt text is empty or too long. Enter manually.");
  return text;
}
