import { money, dateLabel, today } from "@/lib/format";
import { paymentMethodLabels } from "@/lib/invoices";
import { ActionPanel } from "@/components/action-panel";
import { CreditRefundForm } from "@/components/credit-refund-form";
export type CreditRefundRow = {
  id: string;
  refunded_on: string;
  amount_cents: number;
  method: string;
  reason: string;
  reference?: string | null;
  reversed?: boolean;
  reversed_at?: string | null;
  notes?: string | null;
  reversal_reason?: string | null;
  credit_on?: string;
  source?: string;
  credit_id?: string;
};
export function CreditRefundHistory({
  rows,
  admin = false,
}: {
  rows: CreditRefundRow[];
  admin?: boolean;
}) {
  if (!rows.length)
    return (
      <p className="record-form muted">No account-credit refunds recorded.</p>
    );
  return (
    <div className="record-form stack">
      {rows.map((r) => (
        <article className="customer-invoice-row" key={r.id}>
          <div>
            <h3>
              {money(r.amount_cents)} ·{" "}
              {r.reversed || r.reversed_at
                ? "Record reversed"
                : "Returned to customer"}
            </h3>
            <p>
              {dateLabel(r.refunded_on)} · {paymentMethodLabels[r.method]}
            </p>
            <p>{r.reason}</p>
            {r.reference && <p className="muted">Reference: {r.reference}</p>}
            {admin && (
              <>
                <p className="muted">
                  {r.source === "advance"
                    ? "Advance payment"
                    : "Invoice reduction"}{" "}
                  · Credit dated {dateLabel(r.credit_on ?? "")}
                </p>
                {r.notes && (
                  <details>
                    <summary>Private notes</summary>
                    <p className="preserve-lines">{r.notes}</p>
                  </details>
                )}
                {r.reversal_reason && (
                  <p>Private correction: {r.reversal_reason}</p>
                )}
              </>
            )}
          </div>
          {admin && !r.reversed_at && (
            <ActionPanel
              id={`reverse-credit-refund-${r.id}`}
              label="Correct refund record"
            >
              <CreditRefundForm date={today()} refundId={r.id} />
            </ActionPanel>
          )}
        </article>
      ))}
    </div>
  );
}
