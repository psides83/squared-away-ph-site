import { requireAdmin } from "@/lib/auth";
import { money } from "@/lib/format";
import { ActionPanel } from "@/components/action-panel";
import { ReceiptPurchaseCancel } from "@/components/receipt-purchase-cancel";
export async function ReceiptPurchaseItems({ expense }: { expense: string }) {
  const { db } = await requireAdmin();
  const [purchase, lines, duplicateOverride] = await Promise.all([
    db
      .from("inventory_receipt_purchases")
      .select("cancelled_at,cancel_reason,ocr_read_id")
      .eq("id", expense)
      .single(),
    db
      .from("inventory_receipt_lines")
      .select("*")
      .eq("receipt_id", expense)
      .order("position"),
    db
      .from("receipt_duplicate_overrides")
      .select("reason,matching_records,created_at")
      .eq("receipt_id", expense)
      .maybeSingle(),
  ]);
  if (purchase.error || lines.error)
    return (
      <p className="notice error">
        Receipt items could not load. Check the latest migration.
      </p>
    );
  const reading = purchase.data.ocr_read_id
    ? await db
        .from("receipt_ocr_reads")
        .select("extracted_text")
        .eq("id", purchase.data.ocr_read_id)
        .maybeSingle()
    : null;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Saved receipt items</h2>
      </div>
      <div className="record-form stack">
        <p className="muted">
          One expense holds this receipt's total and selected category.
          Inventory item costs include their reviewed discount and tax;
          expense-only items add no stock.
        </p>
        {duplicateOverride.error && (
          <p className="notice error">
            Duplicate-review history could not load.
          </p>
        )}
        {duplicateOverride.data && (
          <details>
            <summary>Why this matching receipt was recorded again</summary>
            <div className="stack feed-comparison-detail">
              <p className="log-notes">{duplicateOverride.data.reason}</p>
              <p className="muted">
                Matching-record snapshot saved with this decision. Later expense
                changes do not rewrite it.
              </p>
              {(
                duplicateOverride.data.matching_records as {
                  id: string;
                  vendor: string | null;
                  expense_date: string;
                  amount_cents: number;
                }[]
              ).map((m) => (
                <p key={m.id}>
                  {m.vendor || "Expense"} · {m.expense_date} ·{" "}
                  {money(m.amount_cents)}
                </p>
              ))}
            </div>
          </details>
        )}
        {purchase.data.ocr_read_id && (
          <details>
            <summary>Receipt-reading source</summary>
            <p>
              Assisted by OCR.space. Saved item values were reviewed separately;
              recognized text is unverified.
            </p>
            {reading?.data?.extracted_text ? (
              <pre
                className="log-notes"
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  font: "inherit",
                }}
              >
                {reading.data.extracted_text}
              </pre>
            ) : (
              <p>Recognized text is unavailable to this account.</p>
            )}
          </details>
        )}
        {purchase.data.cancelled_at && (
          <p className="notice">
            Cancelled: {purchase.data.cancel_reason}. Original item details
            remain below.
          </p>
        )}
        {lines.data.map((l) => (
          <article className="customer-invoice-row" key={l.id}>
            <h3>{l.description}</h3>
            <p>
              {l.kind === "inventory"
                ? `${l.product_name} · ${Number(l.quantity)} ${l.unit_label}`
                : "Expense only · no inventory added"}
            </p>
            <p>
              Subtotal {money(l.subtotal_cents)} · discount{" "}
              {money(l.discount_cents)} · tax {money(l.tax_cents)} ·{" "}
              <strong>{money(l.total_cents)}</strong>
            </p>
          </article>
        ))}
        {!purchase.data.cancelled_at && (
          <ActionPanel id="cancel-receipt" label="Cancel untouched receipt">
            <ReceiptPurchaseCancel expense={expense} />
          </ActionPanel>
        )}
        <p className="muted form-hint">
          Item edits after stock activity require a later reviewed correction
          workflow. Single-item stock correction tools cannot change these
          receipt items. Use Receipts to attach or download the original
          document.
        </p>
      </div>
    </section>
  );
}
