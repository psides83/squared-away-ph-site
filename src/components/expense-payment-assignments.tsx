import Link from "next/link";
import { ExpenseRecoveryForm } from "@/components/expense-recovery-form";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { money } from "@/lib/format";
export type ExpenseRecovery = {
  payments: {
    id: string;
    source_kind?: "payment" | "credit";
    paid_on: string;
    amount_cents: number;
    available_cents: number;
  }[];
  expenses: {
    id: string;
    vendor: string | null;
    expense_date: string;
    cost_cents: number;
  }[];
  assignments: {
    id: string;
    payment_id: string | null;
    credit_application_id?: string | null;
    source_kind?: "payment" | "credit";
    expense_id: string;
    amount_cents: number;
    reason: string;
    retired_at: string | null;
    retired_reason: string | null;
    vendor: string | null;
    counted: boolean;
  }[];
};
export function ExpensePaymentAssignments({
  data,
}: {
  invoice: string;
  data: ExpenseRecovery | null;
}) {
  if (!data)
    return (
      <p className="notice error">
        Expense payment assignments could not load. Check the latest migration.
      </p>
    );
  const recovered = data.assignments
    .filter((a) => a.counted)
    .reduce((sum, a) => sum + Number(a.amount_cents), 0);
  return (
    <section className="panel expense-payment-panel">
      <div className="panel-heading">
        <h2>Expense reimbursements</h2>
        <span className="tag">{money(recovered)} assigned</span>
      </div>
      <div className="record-form stack">
        <p>
          Choose which linked expense costs were repaid by recorded customer
          payments or account credit already applied to this invoice. Unassigned
          money may cover training or other charges; it is not assumed to repay
          expenses.
        </p>
        <HelpPanel title="How expense payment assignments work">
          <p>
            Assignments are capped by the payment or applied credit’s available
            amount and the original cost linked to this invoice. Multiple
            payments can repay one expense, and one payment can cover several
            expenses. Edit or remove assignments deliberately; earlier values
            remain in history. Reversed payments and credit applications stop
            counting automatically.
          </p>
          <p>
            Reports select expenses by their vendor-payment dates and show
            current cumulative assigned recovery, including customer payments
            received later. Recovery is a breakdown of already recorded payments
            and applied credit, never extra revenue. A settled invoice alone
            does not allocate expense recovery; assign it explicitly.
          </p>
        </HelpPanel>
        {data.payments.some((p) => p.available_cents > 0) &&
        data.expenses.length > 0 ? (
          <ActionPanel id="assign-expense-payment" label="Assign reimbursement">
            <ExpenseRecoveryForm data={data} />
          </ActionPanel>
        ) : (
          <p className="muted">
            An unassigned payment or applied account credit and a linked expense
            cost are needed before assigning recovery.
          </p>
        )}
        {data.assignments
          .filter((a) => a.counted)
          .map((a) => (
            <article key={a.id}>
              <p>
                <strong>
                  {a.vendor || "Expense"} · {money(a.amount_cents)} repaid
                  {a.source_kind === "credit"
                    ? " · Account credit"
                    : " · Cash payment"}
                </strong>
              </p>
              <p className="muted">{a.reason}</p>
              <div className="row-actions">
                <Link
                  className="text-link"
                  href={`/admin/expenses/${a.expense_id}`}
                >
                  Expense record
                </Link>
                <ActionPanel
                  id={`edit-recovery-${a.id}`}
                  label="Edit assignment"
                >
                  <ExpenseRecoveryForm data={data} current={a} />
                </ActionPanel>
                <ActionPanel
                  id={`remove-recovery-${a.id}`}
                  label="Remove assignment"
                >
                  <ExpenseRecoveryForm data={data} current={a} remove />
                </ActionPanel>
              </div>
            </article>
          ))}
        <details>
          <summary>Assignment history</summary>
          <div className="stack feed-comparison-detail">
            {!data.assignments.length ? (
              <p>No assignments recorded.</p>
            ) : (
              data.assignments.map((a) => (
                <p key={a.id}>
                  {a.vendor || "Expense"} · {money(a.amount_cents)} ·{" "}
                  {a.source_kind === "credit"
                    ? "Account credit"
                    : "Cash payment"}{" "}
                  ·{" "}
                  {a.counted
                    ? "Counted"
                    : a.retired_at
                      ? "Replaced / removed"
                      : "Payment / credit reversed or record inactive"}{" "}
                  · {a.reason}
                  {a.retired_reason ? ` · ${a.retired_reason}` : ""}
                </p>
              ))
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
