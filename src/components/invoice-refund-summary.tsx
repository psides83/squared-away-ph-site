import { money, dateLabel } from "@/lib/format";
import { paymentMethodLabels } from "@/lib/invoices";
export type PublicRefund = {
  id: string;
  refunded_on: string;
  amount_cents: number;
  method: string;
  reason: string;
  effect: string;
  reference?: string | null;
  reversed?: boolean;
  reversed_at?: string | null;
};
export function InvoiceRefundSummary({ rows }: { rows: PublicRefund[] }) {
  if (!rows.length) return null;
  return (
    <div className="invoice-notes">
      <h3>Refund history</h3>
      {rows.map((r) => (
        <p key={r.id}>
          {dateLabel(r.refunded_on)} · {money(r.amount_cents)} ·{" "}
          {paymentMethodLabels[r.method]} · {r.reason}
          {r.reference ? ` · ${r.reference}` : ""} ·{" "}
          {r.reversed || r.reversed_at
            ? "Record reversed"
            : r.effect === "reduce"
              ? "Invoice charges reduced"
              : "Balance reopened"}
        </p>
      ))}
    </div>
  );
}
