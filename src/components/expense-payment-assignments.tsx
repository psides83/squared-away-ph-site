import Link from "next/link";
import { AppSelect } from "@/components/app-select";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { money, dateLabel } from "@/lib/format";
import { recoveryAction } from "@/app/admin/invoices/recovery-actions";
export type ExpenseRecovery = {
  payments: {
    id: string;
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
    payment_id: string;
    expense_id: string;
    amount_cents: number;
    reason: string;
    retired_at: string | null;
    retired_reason: string | null;
    vendor: string | null;
    counted: boolean;
  }[];
};
function AssignmentForm({
  invoice,
  data,
  current,
}: {
  invoice: string;
  data: ExpenseRecovery;
  current?: ExpenseRecovery["assignments"][number];
}) {
  return (
    <form action={recoveryAction.bind(null, "save")} className="record-form">
      <input type="hidden" name="invoice_id" value={invoice} />
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <input type="hidden" name="current" value={current?.id ?? ""} />
      {current ? (
        <>
          <input type="hidden" name="payment_id" value={current.payment_id} />
          <input type="hidden" name="expense_id" value={current.expense_id} />
          <p>
            {current.vendor || "Expense"} · current assignment{" "}
            {money(current.amount_cents)}
          </p>
        </>
      ) : (
        <>
          <label>
            Recorded payment
            <AppSelect
              aria-label="Recorded payment"
              name="payment_id"
              required
              defaultValue=""
            >
              <option value="">Choose payment</option>
              {data.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {dateLabel(p.paid_on)} · {money(p.amount_cents)} ·{" "}
                  {money(p.available_cents)} unassigned
                </option>
              ))}
            </AppSelect>
          </label>
          <label>
            Linked expense
            <AppSelect
              aria-label="Linked expense"
              name="expense_id"
              required
              defaultValue=""
            >
              <option value="">Choose expense</option>
              {data.expenses.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.vendor || "Expense"} · {dateLabel(e.expense_date)} ·{" "}
                  {money(e.cost_cents)} original cost linked
                </option>
              ))}
            </AppSelect>
          </label>
        </>
      )}
      <div className="form-grid">
        <Field
          label="Cost repaid ($)"
          name="amount"
          type="number"
          min="0.01"
          max="1000000"
          step="0.01"
          required
          defaultValue={
            current ? (current.amount_cents / 100).toFixed(2) : undefined
          }
        />
        <Field
          label="Assignment reason"
          name="reason"
          required
          maxLength={2000}
        />
      </div>
      <p className="form-hint muted">
        Assign original cost only. Fees and other services remain separate. This
        does not add another payment or change the invoice balance.
      </p>
      <div className="form-actions">
        <SubmitButton>Save assignment</SubmitButton>
      </div>
    </form>
  );
}
export function ExpensePaymentAssignments({
  invoice,
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
          payments. Unassigned money may cover training or other charges; it is
          not assumed to repay expenses.
        </p>
        <HelpPanel title="How expense payment assignments work">
          <p>
            Assignments are capped by the payment’s available amount and the
            original cost linked to this invoice. Multiple payments can repay
            one expense, and one payment can cover several expenses. Edit or
            remove assignments deliberately; earlier values remain in history.
            Reversed payments stop counting automatically.
          </p>
          <p>
            Reports select expenses by their vendor-payment dates and show
            current cumulative assigned recovery, including customer payments
            received later. Recovery is a breakdown of already recorded cash,
            never extra revenue. A settled invoice alone does not allocate
            expense recovery; assign it explicitly.
          </p>
        </HelpPanel>
        {data.payments.length > 0 && data.expenses.length > 0 ? (
          <ActionPanel
            id="assign-expense-payment"
            label="Assign payment to expense"
          >
            <div className="panel-heading">
              <h2>Assign payment to expense</h2>
            </div>
            <AssignmentForm invoice={invoice} data={data} />
          </ActionPanel>
        ) : (
          <p className="muted">
            An active payment and a linked expense cost are needed before
            assigning recovery.
          </p>
        )}
        {data.assignments
          .filter((a) => a.counted)
          .map((a) => (
            <article key={a.id}>
              <p>
                <strong>
                  {a.vendor || "Expense"} · {money(a.amount_cents)} repaid
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
                  <div className="panel-heading">
                    <h2>Edit recovered cost</h2>
                  </div>
                  <AssignmentForm invoice={invoice} data={data} current={a} />
                </ActionPanel>
                <ActionPanel
                  id={`remove-recovery-${a.id}`}
                  label="Remove assignment"
                >
                  <form
                    action={recoveryAction.bind(null, "clear")}
                    className="record-form"
                  >
                    <h2>Remove expense payment assignment</h2>
                    <input type="hidden" name="invoice_id" value={invoice} />
                    <input type="hidden" name="current" value={a.id} />
                    <Field
                      label="Removal reason"
                      name="reason"
                      required
                      maxLength={2000}
                    />
                    <div className="form-actions">
                      <ConfirmButton
                        className="button secondary"
                        message="Remove this recovery assignment? The original payment and invoice balance stay unchanged."
                      >
                        Remove assignment
                      </ConfirmButton>
                    </div>
                  </form>
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
                  {a.counted
                    ? "Counted"
                    : a.retired_at
                      ? "Replaced / removed"
                      : "Payment reversed or record inactive"}{" "}
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
