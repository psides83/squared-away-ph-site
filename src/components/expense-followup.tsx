import Link from "next/link";
import { dateLabel, money, today } from "@/lib/format";
export type ExpenseFollowup = {
  expense_id: string;
  receipt_count: number;
  draft_cost_cents: number;
  issued_cost_cents: number;
  invoices: {
    id: string;
    invoice_number: number | null;
    status: string;
    customer_name: string;
    due_date: string;
    balance_cents: number;
    total_cents: number;
    cost_cents: number;
    charge_cents: number;
  }[];
};
export function ExpenseFollowupSummary({
  data,
  reimbursable,
  voided,
}: {
  data?: ExpenseFollowup;
  reimbursable: boolean;
  voided: boolean;
}) {
  if (!data) return <span className="muted">Follow-up unavailable</span>;
  return (
    <div className="contact-cell">
      <span>
        {data.receipt_count}{" "}
        {Number(data.receipt_count) === 1 ? "receipt" : "receipts"}
      </span>
      {!voided &&
        (data.invoices.length ? (
          <>
            <span>
              {Number(data.draft_cost_cents) > 0
                ? `${money(data.draft_cost_cents)} cost on draft`
                : ""}
            </span>
            <span>
              {Number(data.issued_cost_cents) > 0
                ? `${money(data.issued_cost_cents)} cost invoiced`
                : ""}
            </span>
            {data.invoices.some(
              (i) =>
                i.status === "issued" &&
                i.balance_cents > 0 &&
                i.due_date < today(),
            ) && (
              <span className="billing-past-due">Linked invoice past due</span>
            )}
          </>
        ) : (
          <span>{reimbursable ? "Not yet billed" : "No linked invoice"}</span>
        ))}
    </div>
  );
}
export function ExpenseInvoiceLinks({ data }: { data?: ExpenseFollowup }) {
  if (!data)
    return (
      <p className="notice error">
        Billing follow-up could not load. Check the latest migration.
      </p>
    );
  return (
    <div className="stack">
      <p>
        Cost on draft invoices: <strong>{money(data.draft_cost_cents)}</strong>{" "}
        · Cost on issued invoices:{" "}
        <strong>{money(data.issued_cost_cents)}</strong>
      </p>
      {data.invoices.length ? (
        data.invoices.map((i) => (
          <article className="customer-invoice-row" key={i.id}>
            <h3>
              <Link className="text-link" href={`/admin/invoices/${i.id}`}>
                {i.invoice_number
                  ? `Invoice #${i.invoice_number}`
                  : "Draft invoice"}{" "}
                · {i.customer_name}
              </Link>
            </h3>
            <p>
              Expense cost included: {money(i.cost_cents)} · Charge including
              fees: {money(i.charge_cents)}
            </p>
            <p className="muted">
              {i.status === "draft"
                ? "Draft — not yet issued"
                : i.balance_cents <= 0
                  ? "Invoice settled"
                  : i.due_date < today()
                    ? "Invoice past due"
                    : "Invoice outstanding"}{" "}
              · Due {dateLabel(i.due_date)}
            </p>
            {i.status === "issued" && i.balance_cents > 0 && (
              <p>
                Whole-invoice balance: {money(i.balance_cents)}{" "}
                <Link
                  className="text-link"
                  href={`/admin/invoices/${i.id}#invoice-payments`}
                >
                  Record payment
                </Link>
              </p>
            )}
            {i.status === "issued" && (
              <Link
                className="text-link"
                href={`/admin/invoices/${i.id}#invoice-payments`}
              >
                Review payment assignments
              </Link>
            )}
          </article>
        ))
      ) : (
        <p>No draft or issued invoice is linked to this expense.</p>
      )}
      <p className="muted">
        Payment status and balance apply to the whole invoice. Expense recovery
        requires explicit payment assignments; a settled balance alone does not
        assign recovery. Original costs exclude handling fees and are shown
        separately from the amount charged.
      </p>
    </div>
  );
}
