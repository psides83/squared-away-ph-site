import Link from "next/link";
import { money, dateLabel } from "@/lib/format";
import { ActionPanel } from "@/components/action-panel";
import { SupplierExchangeForm } from "@/components/supplier-exchange-form";
export type SupplierExchange = {
  id: string;
  expense_id: string;
  vendor: string;
  expense_date: string;
  amount_cents: number;
  paid_on: string | null;
  voided_at: string | null;
  products: string | null;
  notes: string | null;
  removed_at: string | null;
  remove_reason: string | null;
};
export function SupplierExchangeList({ rows }: { rows: SupplierExchange[] }) {
  return (
    <div className="stack">
      {rows.map((row) => (
        <article className="panel" key={row.id}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {dateLabel(row.expense_date)} · {row.vendor}
              </p>
              <h2>{row.products ?? "Inventory purchase"}</h2>
            </div>
            <span className="tag">
              {row.removed_at ? "Link removed" : "Linked"}
            </span>
          </div>
          <div className="record-form stack">
            <p>
              <strong>{money(row.amount_cents)}</strong> full purchase cost ·{" "}
              {row.voided_at ? "Voided" : row.paid_on ? "Settled" : "Unpaid"}
            </p>
            {row.notes && <p>{row.notes}</p>}
            {row.removed_at && (
              <p className="muted">Removed: {row.remove_reason}</p>
            )}
            <div className="row-actions">
              <Link
                className="button secondary"
                href={`/admin/expenses/${row.expense_id}#expense-supplier-credits`}
              >
                Purchase & supplier credit
              </Link>
              {!row.removed_at && (
                <ActionPanel
                  id={`remove-exchange-${row.id}`}
                  label="Remove link"
                >
                  <SupplierExchangeForm linkId={row.id} />
                </ActionPanel>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
