"use client";
import { useActionState, useState, startTransition } from "react";
import { saveExpenseAbsorption } from "@/app/admin/expenses/absorption-actions";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import type { ExpenseAbsorption } from "@/lib/expense-absorption";
export function ExpenseAbsorptionForm({
  expense,
  available,
  current,
  remove = false,
}: {
  expense: string;
  available: number;
  current?: ExpenseAbsorption;
  remove?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  // Capture the revision when the editor opens, rather than silently adopting refreshed props.
  const [revision] = useState(current?.id ?? "");
  const [state, action, pending] = useActionState(saveExpenseAbsorption, {});
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
        <input name="request_id" type="hidden" value={request} />
        <input name="current" type="hidden" value={revision} />
        <input name="expense_id" type="hidden" value={expense} />
        <input name="remove" type="hidden" value={remove ? "yes" : "no"} />
        {remove ? (
          <p>
            Remove the {money(current?.amount_cents ?? 0)} absorbed designation?
            This makes the cost available for explicit billing again.
          </p>
        ) : (
          <>
            <p>
              Choose the portion this business will cover. Up to{" "}
              {money(available)} is available after costs already reserved on
              draft or issued invoices.
            </p>
            <Field
              label="Absorbed cost ($)"
              name="amount"
              type="number"
              min="0.01"
              max={available / 100}
              step="0.01"
              required
              defaultValue={
                current?.amount_cents
                  ? (current.amount_cents / 100).toFixed(2)
                  : undefined
              }
            />
          </>
        )}
        <Field
          label={remove ? "Removal reason" : "Private reason"}
          name="reason"
          required
          maxLength={2000}
        />
        <p className="muted form-hint">
          No money moves and the expense remains in cash reports. Invoice
          charge-backs use only the unabsorbed portion; boarding claims cannot
          include absorbed cost. This does not allocate package revenue or
          change feed-consumption billing.
        </p>
        <div className="form-actions">
          <ConfirmButton
            message={
              remove
                ? "Remove this absorbed-cost designation? The original decision and this removal remain in history. No invoice is created automatically."
                : "Save this absorbed cost? That amount will be protected from expense charge-backs and actual-cost boarding invoices until you explicitly change or remove the designation."
            }
          >
            {pending
              ? "Saving…"
              : remove
                ? "Remove designation"
                : "Save absorbed cost"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
