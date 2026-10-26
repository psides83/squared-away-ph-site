"use client";
import { useActionState, useState, startTransition } from "react";
import { recoveryAssignmentAction } from "@/app/admin/invoices/recovery-actions";
import { AppSelect } from "@/components/app-select";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { money, dateLabel } from "@/lib/format";
import type { ExpenseRecovery } from "@/components/expense-payment-assignments";
export function ExpenseRecoveryForm({
  data,
  current,
  remove = false,
}: {
  data: ExpenseRecovery;
  current?: ExpenseRecovery["assignments"][number];
  remove?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [source, setSource] = useState(
    current?.credit_application_id
      ? `credit:${current.credit_application_id}`
      : (current?.payment_id ?? ""),
  );
  const [expense, setExpense] = useState(current?.expense_id ?? "");
  const selected = data.payments.find(
    (p) => (p.source_kind === "credit" ? `credit:${p.id}` : p.id) === source,
  );
  const linked = data.expenses.find((e) => e.id === expense);

  const [state, action, pending] = useActionState(recoveryAssignmentAction, {});
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => action(form));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input
          name="operation"
          type="hidden"
          value={remove ? "clear" : "save"}
        />
        <input name="request_id" type="hidden" value={request} />
        <input name="current" type="hidden" value={current?.id ?? ""} />
        {current && (
          <p>
            {current.vendor || "Expense"} · {money(current.amount_cents)}{" "}
            assigned from{" "}
            {current.source_kind === "credit"
              ? "account credit"
              : "a cash payment"}
            .
          </p>
        )}
        {!remove && (
          <>
            {current ? (
              <>
                <input
                  name="payment_id"
                  type="hidden"
                  value={
                    current.credit_application_id
                      ? `credit:${current.credit_application_id}`
                      : (current.payment_id ?? "")
                  }
                />
                <input
                  name="expense_id"
                  type="hidden"
                  value={current.expense_id}
                />
              </>
            ) : (
              <>
                <label className="field supplier-credit-choice">
                  Payment or applied credit
                  <AppSelect
                    name="payment_id"
                    required
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose a source
                    </option>
                    {data.payments
                      .filter((p) => p.available_cents > 0)
                      .map((p) => (
                        <option
                          key={`${p.source_kind ?? "payment"}:${p.id}`}
                          value={
                            p.source_kind === "credit" ? `credit:${p.id}` : p.id
                          }
                        >
                          {p.source_kind === "credit"
                            ? "Account credit"
                            : "Cash payment"}{" "}
                          · {money(p.available_cents)} unassigned ·{" "}
                          {dateLabel(p.paid_on)}
                        </option>
                      ))}
                  </AppSelect>
                </label>
                <label className="field supplier-credit-choice">
                  Linked expense
                  <AppSelect
                    name="expense_id"
                    required
                    value={expense}
                    onChange={(e) => setExpense(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose expense
                    </option>
                    {data.expenses.map((e) => (
                      <option key={e.id} value={e.id}>
                        {money(e.cost_cents)} · {e.vendor || "Expense"} ·{" "}
                        {dateLabel(e.expense_date)}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              </>
            )}
            {selected && (
              <p className="form-hint muted">
                {money(selected.available_cents)} unassigned from this{" "}
                {selected.source_kind === "credit"
                  ? "applied credit"
                  : "payment"}
                {current
                  ? `, plus ${money(current.amount_cents)} in this assignment`
                  : ""}
                .
                {linked
                  ? ` Linked original cost: ${money(linked.cost_cents)}.`
                  : ""}
              </p>
            )}
            <Field
              label="Cost repaid ($)"
              name="amount"
              type="number"
              min="0.01"
              max={
                Math.min(
                  (selected?.available_cents ?? 100000000) +
                    (current?.amount_cents ?? 0),
                  linked?.cost_cents ?? 100000000,
                ) / 100
              }
              step="0.01"
              required
              defaultValue={
                current ? (current.amount_cents / 100).toFixed(2) : undefined
              }
            />
          </>
        )}
        <Field
          label={remove ? "Removal reason" : "Assignment reason"}
          name="reason"
          required
          maxLength={2000}
        />
        <p className="form-hint muted">
          Assign original cost only. Fees and services stay separate.{" "}
          {remove ? "Removing this assignment" : "This breakdown"} does not
          change cash reports or the invoice balance. Reversed payments or
          credit applications stop counting as recovery.
        </p>
        <div className="form-actions">
          <ConfirmButton
            className={remove ? "button secondary" : "button"}
            message={
              remove
                ? "Remove this recovery assignment? Its history is retained. No cash or credit moves and the invoice balance stays unchanged."
                : "Save this breakdown of expense costs repaid? This does not add another payment, apply more account credit or change the invoice balance."
            }
          >
            {pending
              ? "Saving…"
              : remove
                ? "Remove assignment"
                : "Save assignment"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
