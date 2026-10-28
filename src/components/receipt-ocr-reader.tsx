"use client";
import { useEffect, useRef, useState } from "react";
import { ScanText } from "lucide-react";
import {
  recognizeReceipt,
  type ReceiptOcrResult,
} from "@/app/admin/inventory/purchases/ocr-actions";
import { HelpPanel } from "@/components/help-panel";
import { Notice } from "@/components/ui";
export function ReceiptOcrReview({
  result,
  photoUrl,
  onApply,
}: {
  result: ReceiptOcrResult;
  photoUrl?: string;
  onApply: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (!result.suggestion) return null;
  return (
    <div className="stack">
      <h3>Review what was read</h3>
      {photoUrl && (
        <img
          src={photoUrl}
          alt="Selected receipt for comparison"
          style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }}
        />
      )}
      <p>
        {result.suggestion.items.length} possible item rows. No purchase has
        been saved.
      </p>
      <dl className="feed-comparison-metrics">
        <div>
          <dt>Suggested vendor</dt>
          <dd style={{ overflowWrap: "anywhere" }}>
            {result.suggestion.vendor ?? "Needs review"}
          </dd>
        </div>
        <div>
          <dt>Suggested purchase date</dt>
          <dd>{result.suggestion.date ?? "Needs review"}</dd>
        </div>
        <div>
          <dt>Suggested receipt total</dt>
          <dd>
            {result.suggestion.total
              ? `$${result.suggestion.total}`
              : "Needs review"}
          </dd>
        </div>
      </dl>
      {result.suggestion.items.length > 0 && (
        <div className="stack">
          {result.suggestion.items.map((item, index) => (
            <p key={index} style={{ overflowWrap: "anywhere" }}>
              {item.description} · ${item.subtotal}
            </p>
          ))}
        </div>
      )}
      <ul>
        {result.suggestion.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <details>
        <summary>Extracted receipt text</summary>
        <pre
          className="log-notes"
          style={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            font: "inherit",
          }}
        >
          {result.text}
        </pre>
      </details>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => dialog.current?.showModal()}
        >
          Use suggestions in draft
        </button>
      </div>
      <dialog
        ref={dialog}
        className="app-dialog confirmation-dialog"
        onClose={(e) => e.stopPropagation()}
        aria-label="Replace purchase draft with receipt suggestions"
      >
        <div className="confirmation-content">
          <h2>Replace the current draft?</h2>
          <p>
            This replaces the vendor, purchase date, items and receipt totals.
            Quantities, units, tax eligibility and payment status still need
            your review. Existing unsaved item entries will be replaced. Nothing
            is recorded yet.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                onApply();
                dialog.current?.close();
              }}
            >
              Replace draft
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
export function ReceiptOcrReader({
  photo,
  configured,
  onApply,
  onBusy,
}: {
  photo: File | null;
  configured: boolean;
  onApply: (result: ReceiptOcrResult) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [applied, setApplied] = useState(false);
  const [result, setResult] = useState<ReceiptOcrResult>({}),
    [busy, setBusy] = useState(false),
    [request, setRequest] = useState(() => crypto.randomUUID()),
    [url, setUrl] = useState<string>();
  useEffect(() => {
    setResult({});
    setApplied(false);
    setRequest(crypto.randomUUID());
    if (!photo) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(photo);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo]);
  return (
    <div className="stack">
      <p className="form-hint muted">
        Read receipt sends the selected photo to{" "}
        <a
          className="inline-link"
          href="https://ocr.space/ocrapi"
          target="_blank"
          rel="noreferrer"
        >
          OCR.space's free API
        </a>
        . Results are kept privately and only fill a draft for review.
      </p>
      <HelpPanel title="How free receipt reading works">
        <p>
          Photos are prepared under 900 KB. PDFs can still be attached for
          manual entry. Nothing is sent merely by choosing a file. See the
          provider's{" "}
          <a
            className="inline-link"
            href="https://ocr.space/privacypolicy"
            target="_blank"
            rel="noreferrer"
          >
            privacy policy
          </a>{" "}
          for processing details.
        </p>
        <p>
          Reading never saves stock, expenses or payments. Recognized text and
          metadata are retained privately for audit even when no purchase is
          saved. App-wide limits are 20 reads per Central Time day and 200 per
          month, including failed attempts, with one new read per minute per
          administrator. There is no paid fallback or automatic provider retry.
        </p>
      </HelpPanel>
      {!configured && (
        <p className="notice">
          Free receipt reading needs an API key and production setup. You can
          enter this receipt manually now.
        </p>
      )}
      <Notice error={result.error} />
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={
            !configured || !photo || photo.type === "application/pdf" || busy
          }
          onClick={async () => {
            if (!photo) return;
            setBusy(true);
            onBusy(true);
            try {
              const form = new FormData();
              form.set("request_id", request);
              form.set("receipt", photo);
              const response = await recognizeReceipt(form);
              setResult(response);
              if (response.error) setRequest(crypto.randomUUID());
            } catch {
              setResult({
                error:
                  "Receipt reading could not finish. Wait a minute or enter manually.",
              });
              setRequest(crypto.randomUUID());
            } finally {
              setBusy(false);
              onBusy(false);
            }
          }}
        >
          <ScanText size={18} />
          {busy
            ? "Reading receipt…"
            : result.error
              ? "Try another read"
              : "Read receipt"}
        </button>
      </div>
      {result.suggestion && (
        <details open={!applied}>
          <summary>Receipt-reading results</summary>
          <div className="stack feed-comparison-detail">
            <ReceiptOcrReview
              result={result}
              photoUrl={url}
              onApply={() => {
                onApply(result);
                setApplied(true);
              }}
            />
          </div>
        </details>
      )}
    </div>
  );
}
