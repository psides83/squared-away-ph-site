import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { paymentMethodLabels } from "@/lib/invoices";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import {
  CustomerRefundForm,
  type RefundPayment,
} from "@/components/customer-refund-form";
export type CustomerRefund = {
  id: string;
  refunded_on: string;
  amount_cents: number;
  effect: string;
  method: string;
  reason: string;
  reference: string | null;
  notes: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  original_paid_on: string;
};
export function RefundHistory({ rows }: { rows: CustomerRefund[] }) {
  return (
    <div className="stack">
      {rows.map((r) => (
        <article className="panel" key={r.id}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {dateLabel(r.refunded_on)} · {paymentMethodLabels[r.method]}
              </p>
              <h3>{money(r.amount_cents)}</h3>
            </div>
            <span className="tag">
              {r.reversed_at ? "Record reversed" : "Refund recorded"}
            </span>
          </div>
          <div className="record-form stack">
            <p>{r.reason}</p>
            <p className="muted">
              {r.effect === "reduce"
                ? "Invoice charges reduced"
                : "Invoice balance reopened"}{" "}
              · Source payment received {dateLabel(r.original_paid_on)}
            </p>
            {r.reference && <p>Reference: {r.reference}</p>}
            {r.notes && (
              <p className="preserve-lines">Private notes: {r.notes}</p>
            )}
            {r.reversed_at ? (
              <p className="notice">Correction: {r.reversal_reason}</p>
            ) : (
              <ActionPanel
                id={`reverse-refund-${r.id}`}
                label="Correct mistaken record"
              >
                <CustomerRefundForm date={today()} refundId={r.id} />
              </ActionPanel>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
export async function InvoiceRefunds({
  invoice,
  page = 1,
}: {
  invoice: string;
  page?: number;
}) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("invoice_refund_overview", {
    p_invoice: invoice,
    p_page: page,
  });
  if (error || !data)
    return (
      <p className="notice error">
        Refund history could not load. Check the latest migration.
      </p>
    );
  const result = data as {
    total: number;
    refunded_cents: number;
    rows: CustomerRefund[];
    payments: RefundPayment[];
  };
  return (
    <>
      <section className="panel">
        <div className="record-form stack">
          <h2>Completed customer refunds</h2>
          <p>
            <strong>{money(result.refunded_cents)}</strong> refunded on this
            invoice
          </p>
          {result.payments.some((p) => p.available_cents > 0) ? (
            <ActionPanel
              id="record-customer-refund"
              label="Record completed refund"
            >
              <CustomerRefundForm payments={result.payments} date={today()} />
            </ActionPanel>
          ) : (
            <p className="muted">
              No unassigned received money is currently available to refund.
              Refunds require an active finalized invoice and a retained payment
              amount.
            </p>
          )}
          <Link className="button secondary" href="#invoice-payments">
            Review payments & expense assignments
          </Link>
        </div>
      </section>
      <HelpPanel title="Refund effects and correcting mistakes">
        <p>
          Record only money already returned. Choose Reduce charges to add a
          matching credit adjustment and keep the balance due unchanged, or
          Reopen balance to make the refunded amount payable again under the
          existing due date. Customer credit accounts and money transfers are
          separate future features.
        </p>
        <p>
          Refunds reduce cash on their actual returned dates. Horse and
          training-visit reports include them as negative receipts under the
          invoice’s reporting assignment. A matching credit adjustment is not
          another cash outflow. Assignments to reimbursed expenses must be
          reduced deliberately before refunding that money; the app will not
          decide which expenses were repaid for you.
        </p>
        <p>
          Correct mistaken refund entries only. Reversal retains the original
          record, restates its cash period and reverses its linked credit
          adjustment. If a reopened balance has since been paid or reduced,
          correct those later entries first. This does not recover refunded
          money from the customer.
        </p>
        <p>
          Payment choices include the first 100 eligible active payments on this
          invoice. Refund history uses 25 entries per page; totals include all
          active refunds.
        </p>
      </HelpPanel>
      <RefundHistory rows={result.rows} />
      {!result.rows.length && (
        <p className="notice">No customer refunds recorded.</p>
      )}
      <nav className="row-actions" aria-label="Invoice refund history">
        {page > 1 && (
          <Link
            className="button secondary"
            href={`?refund_page=${page - 1}#invoice-refunds`}
          >
            Newer refunds
          </Link>
        )}
        {page * 25 < result.total && (
          <Link
            className="button secondary"
            href={`?refund_page=${page + 1}#invoice-refunds`}
          >
            Older refunds
          </Link>
        )}
      </nav>
    </>
  );
}
